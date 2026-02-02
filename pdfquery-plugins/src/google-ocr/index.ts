/**
 * Google Document AI OCR plugin.
 *
 * Source plugin — produces OCR blocks + page images.
 * Factory closure captures backend details (credentials, PDF input).
 *
 * Sets artifacts:
 *   - pages:images  (PageImage[])
 *   - ocr:pages     (OcrPage[])
 *   - pdf:input     (PDFInput)
 */

import type { PDFQueryPlugin, Tag } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { GoogleOcrConfig, OcrPage, OcrBlock } from '../types';
import type { PageImage, PDFInput } from '../types';

/**
 * Convert OcrPage[] to Tag[] for the query engine.
 */
function ocrPagesToTags(pages: OcrPage[]): Tag[] {
  const tags: Tag[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      tags.push({
        id: block.id,
        type: 'ocr',
        page: block.page,
        bbox: block.bbox,
        text: block.text,
        attrs: { confidence: block.confidence },
      });
    }
    for (const table of page.tables) {
      tags.push({
        id: table.id,
        type: 'table',
        page: table.page,
        bbox: table.bbox,
        text: table.markdown,
        attrs: { confidence: table.confidence },
      });
    }
  }
  return tags;
}

/**
 * Create a Google Document AI OCR plugin.
 *
 * Skeleton implementation — real I/O (callDocAI) is not included.
 * Consumers provide the actual processing result or override `run`.
 */
export function googleOcr(config: GoogleOcrConfig): PDFQueryPlugin {
  return {
    name: 'google-ocr',
    async run(ctx) {
      // Store the PDF input as an artifact for downstream plugins
      ctx.artifacts.set(ARTIFACT_KEYS.PDF_INPUT, config.pdf);

      // Skeleton: in a real implementation, this calls Google Document AI.
      // For now, emit empty results. Consumers can use fromDocAIPlugin()
      // for pre-cached results or override with their own run().
      const pages: OcrPage[] = [];
      const pageImages: PageImage[] = [];

      ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, pages);
      ctx.emit('google-ocr:complete', { pageCount: pages.length });

      return { tags: ocrPagesToTags(pages) };
    },
  };
}

export { ocrPagesToTags };
