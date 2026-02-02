/**
 * OkraPDF OCR plugin — extract via OkraPDF's own API.
 *
 * Uploads PDF → creates OCR job → polls for completion → fetches
 * entities and page data → produces tags.
 *
 * Sets artifacts:
 *   - pdf:input    (PDFInput)
 *   - ocr:pages    (OcrPage[])
 */

import { readFile } from 'node:fs/promises';
import type { PDFQueryPlugin, Tag } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { OcrPage } from '../types';

export interface OkraOcrConfig {
  /** PDF to process — file path, buffer, or URL */
  pdf:
    | { type: 'path'; path: string }
    | { type: 'buffer'; data: Buffer | Uint8Array; fileName?: string }
    | { type: 'url'; url: string };
  /** OkraPDF API base URL (default: https://okrapdf.com) */
  apiBase?: string;
  /** API key for authenticated access — defaults to process.env.OKRAPDF_API_KEY */
  apiKey?: string;
  /** Poll interval in ms (default: 3000) */
  pollIntervalMs?: number;
  /** Max wait time in ms (default: 300000 = 5min) */
  timeoutMs?: number;
}

interface OkraEntity {
  id: string;
  type: string;
  title: string;
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  confidence?: number;
  schema?: string[];
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create an OkraPDF OCR plugin.
 *
 * @example
 * ```ts
 * // From URL
 * const doc = await pdfquery.load([
 *   okraOcr({ pdf: { type: 'url', url: 'https://example.com/report.pdf' } }),
 * ]);
 *
 * // From local file
 * const doc = await pdfquery.load([
 *   okraOcr({ pdf: { type: 'path', path: './report.pdf' } }),
 * ]);
 * ```
 */
export function okraOcr(config: OkraOcrConfig): PDFQueryPlugin {
  const {
    apiBase = 'https://okrapdf.com',
    apiKey = process.env.OKRAPDF_API_KEY,
    pollIntervalMs = 3000,
    timeoutMs = 300_000,
  } = config;

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
    return h;
  }

  return {
    name: 'okra-ocr',
    async run(ctx) {
      ctx.emit('okra-ocr:start');

      // 1. Submit extraction job
      let jobId: string;

      if (config.pdf.type === 'url') {
        // Direct URL extraction via public API
        const res = await fetch(`${apiBase}/api/ocr/extract`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ url: config.pdf.url }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`okra-ocr extract failed: ${res.status} ${body.slice(0, 200)}`);
        }
        const data = await res.json() as { jobId?: string; job_id?: string };
        jobId = data.jobId || data.job_id || '';
      } else {
        // File upload — get signed URL, upload, then create job
        let fileData: Buffer | Uint8Array;
        let fileName: string;
        if (config.pdf.type === 'path') {
          fileData = await readFile(config.pdf.path);
          fileName = config.pdf.path.split('/').pop() || 'document.pdf';
        } else {
          fileData = config.pdf.data;
          fileName = config.pdf.fileName || 'document.pdf';
        }

        // Upload via public upload endpoint
        const formData = new FormData();
        formData.append('file', new Blob([new Uint8Array(fileData)], { type: 'application/pdf' }), fileName);

        const uploadRes = await fetch(`${apiBase}/api/public/upload`, {
          method: 'POST',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          body: formData,
        });
        if (!uploadRes.ok) {
          const body = await uploadRes.text();
          throw new Error(`okra-ocr upload failed: ${uploadRes.status} ${body.slice(0, 200)}`);
        }
        const uploadData = await uploadRes.json() as { jobId?: string; job_id?: string };
        jobId = uploadData.jobId || uploadData.job_id || '';
      }

      if (!jobId) throw new Error('okra-ocr: no job ID returned');
      ctx.emit('okra-ocr:job-created', { jobId });

      // 2. Poll for completion
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const statusRes = await fetch(`${apiBase}/api/ocr/jobs/${jobId}`, {
          headers: headers(),
        });
        if (!statusRes.ok) throw new Error(`okra-ocr status check failed: ${statusRes.status}`);
        const job = await statusRes.json() as { status: string };

        if (job.status === 'completed' || job.status === 'done') break;
        if (job.status === 'failed' || job.status === 'error') {
          throw new Error(`okra-ocr: job failed`);
        }

        await sleep(pollIntervalMs);
      }
      if (Date.now() >= deadline) throw new Error('okra-ocr: timeout');

      // 3. Fetch entities
      const entitiesRes = await fetch(`${apiBase}/api/ocr/jobs/${jobId}/entities?type=all`, {
        headers: headers(),
      });
      if (!entitiesRes.ok) throw new Error(`okra-ocr entities fetch failed: ${entitiesRes.status}`);
      const entitiesData = await entitiesRes.json() as { entities: OkraEntity[] };

      // 4. Convert to tags
      const tags: Tag[] = [];
      const ocrPageMap = new Map<number, OcrPage>();

      for (const entity of entitiesData.entities) {
        const bbox = entity.bbox;
        const confidence = entity.confidence ?? 1;

        // Map entity types to tag types
        let tagType: string;
        switch (entity.type) {
          case 'table': tagType = 'table'; break;
          case 'figure': tagType = 'figure'; break;
          case 'footnote': tagType = 'footnote'; break;
          default: tagType = 'ocr'; break;
        }

        tags.push({
          id: entity.id,
          type: tagType,
          page: entity.page,
          bbox,
          text: entity.title,
          attrs: { confidence },
        });

        // Build OcrPages
        if (!ocrPageMap.has(entity.page)) {
          ocrPageMap.set(entity.page, { page: entity.page, blocks: [], tables: [] });
        }
        const ocrPage = ocrPageMap.get(entity.page)!;

        if (tagType === 'table') {
          ocrPage.tables.push({
            id: entity.id,
            page: entity.page,
            markdown: entity.title,
            bbox,
            confidence,
          });
        } else {
          ocrPage.blocks.push({
            id: entity.id,
            page: entity.page,
            text: entity.title,
            bbox,
            confidence,
          });
        }
      }

      const ocrPages = Array.from(ocrPageMap.values()).sort((a, b) => a.page - b.page);

      ctx.artifacts.set(ARTIFACT_KEYS.PDF_INPUT, config.pdf);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);

      ctx.emit('okra-ocr:complete', { jobId, entities: tags.length, pages: ocrPages.length });
      return { tags };
    },
  };
}
