/**
 * VLM Entity Detection plugin.
 *
 * Reads page images from artifacts (set by OCR plugin), sends to a
 * vision-language model to detect tables, figures, footnotes.
 *
 * Depends: google-ocr (or any plugin that sets pages:images)
 * Reads artifacts:
 *   - pages:images (PageImage[])
 * Returns: table/figure/footnote tags
 */

import type { PDFQueryPlugin, Tag } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { VlmEntityDetectConfig } from '../types';
import type { PageImage } from '../types';

/**
 * Create a VLM entity detection plugin.
 *
 * Skeleton implementation — real VLM call not included.
 */
export function vlmEntityDetect(config: VlmEntityDetectConfig = {}): PDFQueryPlugin {
  return {
    name: 'vlm-entity-detect',
    depends: ['google-ocr'],
    async run(ctx) {
      const pageImages = ctx.artifacts.get(ARTIFACT_KEYS.PAGE_IMAGES) as PageImage[] | undefined;

      if (!pageImages || pageImages.length === 0) {
        ctx.emit('vlm-entity-detect:skip', { reason: 'no page images' });
        return { tags: [] };
      }

      // Skeleton: in a real implementation, this sends each page image
      // to a VLM (e.g. GPT-4V, Gemini Pro Vision) to detect entities.
      const tags: Tag[] = [];

      ctx.emit('vlm-entity-detect:complete', {
        pageCount: pageImages.length,
        entityCount: tags.length,
      });

      return { tags };
    },
  };
}
