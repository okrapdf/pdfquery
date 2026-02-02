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
 * Depends: any source plugin that sets pages:images, plus a VLM handler (vlm:call)
 * Reads artifacts:
 *   - pages:images (PageImage[])
 *   - vlm:call    (VLMCallHandler)
 * Returns: table/figure tags with VLM-detected bboxes
 */

import type { PDFQueryPlugin, Tag } from 'pdfquery';
import type { VLMCallHandler } from 'pdfquery';
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
  'Return a JSON array of objects: { "type": string, "bbox": { "x": number, "y": number, "width": number, "height": number }, "description": string, "confidence": number }.',
  'Coordinates are normalized 0-1. Return [] if none found.',
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
            const normalized = normalizeBbox(det.bbox, img.width, img.height);
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

/**
 * Normalize any bbox format to {x, y, width, height} in 0-1 range.
 *
 * Matches the normalization in PdfPageWithOverlay.tsx and
 * /api/ocr/metadata/[jobId]/route.ts:
 *   - Handles negative width/height (flips origin)
 *   - Array [x1,y1,x2,y2] treated as 0-1000 Qwen grounding scale (÷1000)
 *   - Object {x,y,width,height} with values >1 treated as 0-1000 (÷1000)
 *
 * Accepted formats:
 *   { x, y, width, height }         — 0-1 or 0-1000 (auto-detected)
 *   { xmin, ymin, xmax, ymax }      — 0-1 or 0-1000 (auto-detected)
 *   [x1, y1, x2, y2]               — 0-1000 Qwen grounding coords
 */
function normalizeBbox(
  bbox: unknown,
  _pageWidth: number,
  _pageHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  if (!bbox) return null;

  let x: number, y: number, w: number, h: number;

  if (Array.isArray(bbox)) {
    // Array format: [x1, y1, x2, y2] — Qwen 0-1000 grounding coords
    if (bbox.length < 4 || bbox.some(v => typeof v !== 'number')) return null;
    const [x1, y1, x2, y2] = bbox as number[];
    x = x1 / 1000;
    y = y1 / 1000;
    w = (x2 - x1) / 1000;
    h = (y2 - y1) / 1000;
  } else if (typeof bbox === 'object') {
    const b = bbox as Record<string, unknown>;

    if (typeof b.x === 'number' && typeof b.y === 'number'
      && typeof b.width === 'number' && typeof b.height === 'number') {
      x = b.x; y = b.y; w = b.width; h = b.height;
    } else if (typeof b.xmin === 'number' && typeof b.ymin === 'number'
      && typeof b.xmax === 'number' && typeof b.ymax === 'number') {
      x = b.xmin; y = b.ymin; w = b.xmax - b.xmin; h = b.ymax - b.ymin;
    } else {
      return null;
    }

    // Auto-detect 0-1000 scale: if any value > 1, divide by 1000
    if (x > 1 || y > 1 || w > 1 || h > 1) {
      x /= 1000; y /= 1000; w /= 1000; h /= 1000;
    }
  } else {
    return null;
  }

  // Handle negative dimensions (same as PdfPageWithOverlay.normalizeBbox)
  if (w < 0) { x += w; w = Math.abs(w); }
  if (h < 0) { y += h; h = Math.abs(h); }

  return { x, y, width: w, height: h };
}

function clampBbox(bbox: { x: number; y: number; width: number; height: number }) {
  const x = Math.max(0, Math.min(1, bbox.x));
  const y = Math.max(0, Math.min(1, bbox.y));
  const width = Math.max(0, Math.min(1 - x, bbox.width));
  const height = Math.max(0, Math.min(1 - y, bbox.height));
  return { x, y, width, height };
}

/** Parse VLM response — handles raw JSON or markdown-fenced JSON blocks */
function parseDetections(raw: string): Array<{
  type: string;
  bbox: { x: number; y: number; width: number; height: number };
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
