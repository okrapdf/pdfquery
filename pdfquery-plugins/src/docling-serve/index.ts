/**
 * Docling Serve plugin — parse PDFs via self-hosted docling-serve REST API.
 *
 * Sends PDF to docling-serve → receives DoclingDocument JSON → normalizes
 * via the existing fromDocling adapter → produces tags.
 *
 * Requires: `pip install "docling-serve[ui]" && docling-serve run`
 *
 * Sets artifacts:
 *   - pdf:input    (PDFInput)
 *   - ocr:pages    (OcrPage[])
 */

import { readFile } from 'node:fs/promises';
import type { PDFQueryPlugin } from 'pdfquery';
import { fromDocling } from 'pdfquery';
import type { DoclingDocument } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import { adapterResultToTags, adapterResultToOcrPages } from '../adapter-bridges';

export interface DoclingServeConfig {
  /** PDF to process — file path or buffer */
  pdf: { type: 'path'; path: string } | { type: 'buffer'; data: Buffer | Uint8Array; fileName?: string };
  /** Docling serve base URL (default: http://localhost:5001) */
  apiBase?: string;
  /** Request timeout in ms (default: 120000) */
  timeoutMs?: number;
}

/**
 * Create a Docling Serve plugin.
 *
 * @example
 * ```ts
 * const doc = await pdfquery.load([
 *   doclingServe({ pdf: { type: 'path', path: './report.pdf' } }),
 * ]);
 * doc.$('table').count();
 * ```
 */
export function doclingServe(config: DoclingServeConfig): PDFQueryPlugin {
  const {
    apiBase = 'http://localhost:5001',
    timeoutMs = 120_000,
  } = config;

  return {
    name: 'docling',
    async run(ctx) {
      ctx.emit('docling:start');

      // Build form data
      const formData = new FormData();
      let fileBlob: Blob;
      let fileName: string;

      if (config.pdf.type === 'path') {
        const data = await readFile(config.pdf.path);
        fileBlob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
        fileName = config.pdf.path.split('/').pop() || 'document.pdf';
      } else {
        fileBlob = new Blob([new Uint8Array(config.pdf.data)], { type: 'application/pdf' });
        fileName = config.pdf.fileName || 'document.pdf';
      }
      formData.append('files', fileBlob, fileName);

      // Send to docling-serve
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(`${apiBase}/v1/convert/file`, {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`docling-serve: ${res.status} ${body.slice(0, 200)}`);
        }

        const result = await res.json() as { document: DoclingDocument };
        const doclingDoc = result.document;

        // Use existing fromDocling adapter to normalize
        const adapterResult = fromDocling(doclingDoc);

        ctx.artifacts.set(ARTIFACT_KEYS.PDF_INPUT, config.pdf);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, adapterResultToOcrPages(adapterResult));

        const tags = adapterResultToTags(adapterResult);

        ctx.emit('docling:complete', {
          pages: adapterResult.pageCount,
          blocks: adapterResult.blocks.length,
          tables: adapterResult.tables.length,
        });

        return { tags };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
