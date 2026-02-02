/**
 * VLM Markdown Extraction plugin.
 *
 * Reads page images + OCR pages from artifacts, sends to a VLM
 * to produce structured markdown per page.
 *
 * Depends: google-ocr (or any plugin that sets pages:images + ocr:pages)
 * Reads artifacts:
 *   - pages:images  (PageImage[])
 *   - ocr:pages     (OcrPage[])
 * Returns: markdown tags + PageData
 */

import type { PDFQueryPlugin, Tag, PageData } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { VlmMarkdownConfig, OcrPage } from '../types';
import type { PageImage } from '../types';

/**
 * Create a VLM markdown extraction plugin.
 *
 * Skeleton implementation — real VLM call not included.
 */
export function vlmMarkdown(config: VlmMarkdownConfig = {}): PDFQueryPlugin {
  return {
    name: 'vlm-markdown',
    depends: ['google-ocr'],
    async run(ctx) {
      const pageImages = ctx.artifacts.get(ARTIFACT_KEYS.PAGE_IMAGES) as PageImage[] | undefined;
      const ocrPages = ctx.artifacts.get(ARTIFACT_KEYS.OCR_PAGES) as OcrPage[] | undefined;

      if (!pageImages || pageImages.length === 0) {
        ctx.emit('vlm-markdown:skip', { reason: 'no page images' });
        return { tags: [] };
      }

      // Skeleton: in a real implementation, this sends page images + OCR context
      // to a VLM to produce markdown for each page.
      const tags: Tag[] = [];

      ctx.emit('vlm-markdown:complete', {
        pageCount: pageImages.length,
      });

      return { tags };
    },
  };
}
