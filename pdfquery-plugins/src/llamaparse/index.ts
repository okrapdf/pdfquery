/**
 * LlamaParse plugin — parse PDFs via LlamaIndex Cloud API.
 *
 * Upload → poll → fetch JSON result with layout bboxes.
 * Returns ocr + table tags with normalized 0-1 bounding boxes.
 *
 * Sets artifacts:
 *   - pdf:input    (PDFInput)
 *   - ocr:pages    (OcrPage[])
 */

import { readFile } from 'node:fs/promises';
import type { PDFQueryPlugin, Tag } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { OcrPage, OcrBlock } from '../types';

export interface LlamaParseConfig {
  /** PDF to process — file path or buffer */
  pdf: { type: 'path'; path: string } | { type: 'buffer'; data: Buffer | Uint8Array; fileName?: string };
  /** LlamaIndex Cloud API key — defaults to process.env.LLAMAINDEX_API_KEY */
  apiKey?: string;
  /** API base URL (default: https://api.cloud.llamaindex.ai) */
  apiBase?: string;
  /** Result type — json gives bboxes, markdown gives text only (default: json) */
  resultType?: 'json' | 'markdown';
  /** Poll interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Max wait time in ms (default: 300000 = 5min) */
  timeoutMs?: number;
  /** Target specific pages: "1,3,5-10" */
  targetPages?: string;
}

interface LlamaParseLayoutItem {
  label: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence?: number;
}

interface LlamaParsePageResult {
  page: number;
  text: string;
  markdown: string;
  layout?: LlamaParseLayoutItem[];
}

interface LlamaParseJsonResult {
  pages: LlamaParsePageResult[];
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a LlamaParse plugin.
 *
 * @example
 * ```ts
 * const doc = await pdfquery.load([
 *   llamaParse({ pdf: { type: 'path', path: './report.pdf' } }),
 * ]);
 * doc.$('table').count();
 * doc.$('ocr').contains('revenue').texts();
 * ```
 */
export function llamaParse(config: LlamaParseConfig): PDFQueryPlugin {
  const {
    apiKey = process.env.LLAMAINDEX_API_KEY,
    apiBase = 'https://api.cloud.llamaindex.ai',
    resultType = 'json',
    pollIntervalMs = 2000,
    timeoutMs = 300_000,
    targetPages,
  } = config;

  return {
    name: 'llamaparse',
    async run(ctx) {
      if (!apiKey) throw new Error('llamaparse: LLAMAINDEX_API_KEY not set');

      ctx.emit('llamaparse:start');

      // 1. Build form data for upload
      const formData = new FormData();

      let fileBlob: Blob;
      let fileName: string;
      if (config.pdf.type === 'path') {
        const data = await readFile(config.pdf.path);
        fileBlob = new Blob([data], { type: 'application/pdf' });
        fileName = config.pdf.path.split('/').pop() || 'document.pdf';
      } else {
        fileBlob = new Blob([config.pdf.data], { type: 'application/pdf' });
        fileName = config.pdf.fileName || 'document.pdf';
      }
      formData.append('file', fileBlob, fileName);
      formData.append('extract_layout', 'true');
      if (targetPages) formData.append('target_pages', targetPages);

      // 2. Upload
      const uploadRes = await fetch(`${apiBase}/api/parsing/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (!uploadRes.ok) {
        const body = await uploadRes.text();
        throw new Error(`llamaparse upload failed: ${uploadRes.status} ${body.slice(0, 200)}`);
      }
      const { id: jobId } = await uploadRes.json() as { id: string };
      ctx.emit('llamaparse:uploaded', { jobId });

      // 3. Poll for completion
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const statusRes = await fetch(`${apiBase}/api/parsing/job/${jobId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!statusRes.ok) throw new Error(`llamaparse status check failed: ${statusRes.status}`);
        const { status } = await statusRes.json() as { status: string };

        if (status === 'SUCCESS') break;
        if (status === 'ERROR') throw new Error('llamaparse: job failed');

        await sleep(pollIntervalMs);
      }
      if (Date.now() >= deadline) throw new Error('llamaparse: timeout waiting for job');

      // 4. Fetch result
      const resultUrl = resultType === 'json'
        ? `${apiBase}/api/parsing/job/${jobId}/result/json`
        : `${apiBase}/api/parsing/job/${jobId}/result/markdown`;

      const resultRes = await fetch(resultUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resultRes.ok) throw new Error(`llamaparse result fetch failed: ${resultRes.status}`);

      // 5. Convert to tags
      const tags: Tag[] = [];
      const ocrPages: OcrPage[] = [];

      if (resultType === 'json') {
        const json = await resultRes.json() as LlamaParseJsonResult;

        for (const page of json.pages) {
          const pageNum = page.page;
          const blocks: OcrBlock[] = [];

          if (page.layout && page.layout.length > 0) {
            for (let i = 0; i < page.layout.length; i++) {
              const item = page.layout[i];
              const id = `lp-${pageNum}-${i}`;
              const bbox = { x: item.bbox.x, y: item.bbox.y, width: item.bbox.w, height: item.bbox.h };
              const confidence = item.confidence ?? 1;

              if (item.label === 'table') {
                tags.push({ id, type: 'table', page: pageNum, bbox, text: '', attrs: { confidence } });
              } else {
                const type = item.label === 'figure' ? 'figure' : 'ocr';
                tags.push({ id, type, page: pageNum, bbox, text: '', attrs: { confidence } });
                blocks.push({ id, page: pageNum, text: '', bbox, confidence });
              }
            }
          }

          // Always add a full-page OCR block with the page text
          if (page.text || page.markdown) {
            const textId = `lp-text-${pageNum}`;
            const text = page.markdown || page.text;
            tags.push({
              id: textId,
              type: 'ocr',
              page: pageNum,
              bbox: { x: 0, y: 0, width: 1, height: 1 },
              text,
              attrs: { confidence: 1 },
            });
            blocks.push({
              id: textId,
              page: pageNum,
              text,
              bbox: { x: 0, y: 0, width: 1, height: 1 },
              confidence: 1,
            });
          }

          ocrPages.push({ page: pageNum, blocks, tables: [] });
        }
      } else {
        // Markdown mode — single text block per page (no bboxes)
        const markdown = await resultRes.text();
        tags.push({
          id: 'lp-md-1',
          type: 'markdown',
          page: 1,
          bbox: { x: 0, y: 0, width: 1, height: 1 },
          text: markdown,
          attrs: { confidence: 1 },
        });
      }

      ctx.artifacts.set(ARTIFACT_KEYS.PDF_INPUT, config.pdf);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);

      ctx.emit('llamaparse:complete', { pages: ocrPages.length, tags: tags.length });
      return { tags };
    },
  };
}
