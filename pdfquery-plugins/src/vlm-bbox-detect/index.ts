/**
 * VLM Bounding Box Detection plugin.
 *
 * Sends page images to a VLM (via vlm:call artifact) and asks it to detect
 * entities with bounding boxes — tables, figures, etc.
 *
 * Mirrors what extract-ocr-metadata.ts does in the Vercel Workflow, but as a
 * composable pdfquery plugin. Tags carry `attrs.source = 'vlm-bbox'` so
 * consumers can distinguish them from OCR-sourced tags.
 *
 * Normalization convention (same as okrapdf):
 *   VLM returns 0-1000 integer coords → plugin calls core normalizeBbox()
 *   → Tag.bbox is always 0-1 { x, y, width, height }
 *
 * Depends: any source plugin that sets pages:images, plus a VLM handler (vlm:call)
 * Reads artifacts:
 *   - pages:images (PageImage[])
 *   - vlm:call    (VLMCallHandler)
 * Returns: table/figure tags with VLM-detected bboxes
 */

import type { PDFQueryPlugin, Tag } from 'pdfquery';
import type { VLMCallHandler } from 'pdfquery';
import { normalizeBbox, clampBbox } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { PageImage } from '../types';

export interface VLMBboxDetectConfig {
  /** Entity types to detect. Default: ['table', 'figure'] */
  types?: string[];
  /** Custom prompt template. {{types}} replaced with comma-separated types. */
  prompt?: string;
  /** Limit to specific page numbers (1-indexed). Default: all pages. */
  pages?: number[];
}

const DEFAULT_PROMPT = [
  'Detect all {{types}} on this page.',
  'Return a JSON array of objects: { "type": string, "bbox": [x1, y1, x2, y2], "description": string, "confidence": number }.',
  'Coordinates are integers in the 0-1000 range where (0,0) is top-left and (1000,1000) is bottom-right.',
  'Return [] if none found.',
].join(' ');

export function vlmBboxDetect(config: VLMBboxDetectConfig = {}): PDFQueryPlugin {
  const types = config.types ?? ['table', 'figure'];
  const promptTemplate = config.prompt ?? DEFAULT_PROMPT;
  const targetPages = config.pages ? new Set(config.pages) : null;

  return {
    name: 'vlm-bbox-detect',
    depends: ['google-ocr'],
    async run(ctx) {
      const pageImages = ctx.artifacts.get(ARTIFACT_KEYS.PAGE_IMAGES) as PageImage[] | undefined;
      const vlmCall = ctx.artifacts.get('vlm:call') as VLMCallHandler | undefined;

      if (!pageImages?.length) {
        ctx.emit('vlm-bbox-detect:skip', { reason: 'no page images' });
        return { tags: [] };
      }

      if (!vlmCall) {
        ctx.emit('vlm-bbox-detect:skip', { reason: 'no vlm:call handler' });
        return { tags: [] };
      }

      const prompt = promptTemplate.replace('{{types}}', types.join(', '));
      const tags: Tag[] = [];

      const filtered = targetPages
        ? pageImages.filter(img => targetPages.has(img.page))
        : pageImages;

      for (let i = 0; i < filtered.length; i++) {
        const img = filtered[i];
        try {
          ctx.emit('vlm-bbox-detect:page-start', { page: img.page, index: i, total: filtered.length });
          const t0 = Date.now();
          const response = await vlmCall([{ image: img }], prompt);
          ctx.emit('vlm-bbox-detect:page-done', { page: img.page, ms: Date.now() - t0, chars: response.length });
          ctx.emit('vlm-bbox-detect:raw', { page: img.page, response: response.slice(0, 500) });
          const detections = parseDetections(response);
          ctx.emit('vlm-bbox-detect:parsed', { page: img.page, count: detections.length });

          for (const det of detections) {
            if (!types.includes(det.type)) continue;
            // Plugin boundary: normalize raw VLM bbox → canonical 0-1 BBox
            const normalized = normalizeBbox(det.bbox);
            if (!normalized) {
              ctx.emit('vlm-bbox-detect:invalid', { page: img.page, detection: det });
              continue;
            }
            tags.push({
              id: `vlm-bbox-p${img.page}-${det.type}-${tags.length}`,
              type: det.type,
              page: img.page,
              bbox: clampBbox(normalized),
              text: det.description ?? '',
              attrs: {
                source: 'vlm-bbox',
                confidence: det.confidence ?? 0.8,
              },
            });
          }
        } catch (err) {
          ctx.emit('vlm-bbox-detect:error', { page: img.page, error: err });
        }
      }

      ctx.emit('vlm-bbox-detect:done', { count: tags.length });
      return { tags };
    },
  };
}

/** Parse VLM response — handles raw JSON or markdown-fenced JSON blocks */
function parseDetections(raw: string): Array<{
  type: string;
  bbox: unknown; // raw from VLM — normalizeBbox() handles all formats
  description?: string;
  confidence?: number;
}> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      const parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    return [];
  }
}
