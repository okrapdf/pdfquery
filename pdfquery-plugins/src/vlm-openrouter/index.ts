/**
 * VLM OpenRouter plugin.
 *
 * Registers a `vlm:call` artifact handler that sends page images + prompt
 * to a vision model via OpenRouter's /chat/completions endpoint.
 *
 * When a crop region is provided (non-page selection), draws a bounding box
 * highlight on the full page image so the VLM knows where to look.
 *
 * Usage:
 *   const doc = await pdfquery.load([
 *     pymupdf({ pdf, extractImages: true }),
 *     vlmOpenRouter(),
 *   ]);
 *   await doc.$('page:first').vlm('what is this page about?')
 *   await doc.$('table').css({ margin: 20 }).vlm('extract amounts')
 */

import sharp from 'sharp';
import type { PDFQueryPlugin, VLMImage } from 'pdfquery';

export interface VLMOpenRouterConfig {
  /** OpenRouter API key — defaults to process.env.OPENROUTER_API_KEY */
  apiKey?: string;
  /** Model ID (default: qwen/qwen3-vl-235b-a22b-instruct) */
  model?: string;
  /** Max output tokens (default: 2048) */
  maxTokens?: number;
}

/**
 * Draw a bounding box highlight on a full page image.
 * Returns the annotated PNG buffer (same dimensions as input).
 */
export async function highlightRegion(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  region: { xmin: number; ymin: number; xmax: number; ymax: number },
  options?: { stroke?: string; strokeWidth?: number; fill?: string },
): Promise<Buffer> {
  const { stroke = '#ff0000', strokeWidth = 3, fill = 'rgba(255,0,0,0.08)' } = options ?? {};

  const x = Math.round(region.xmin * width);
  const y = Math.round(region.ymin * height);
  const w = Math.round((region.xmax - region.xmin) * width);
  const h = Math.round((region.ymax - region.ymin) * height);

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}"
            fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
    </svg>`
  );

  return sharp(Buffer.from(data))
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

/**
 * Crop an image buffer to a normalized 0-1 bounding box.
 * Use with .transform() (future) for destructive crops.
 */
export async function cropImage(
  data: Buffer | Uint8Array,
  width: number,
  height: number,
  crop: { xmin: number; ymin: number; xmax: number; ymax: number },
): Promise<{ data: Buffer; width: number; height: number }> {
  const left = Math.round(crop.xmin * width);
  const top = Math.round(crop.ymin * height);
  const cropW = Math.round((crop.xmax - crop.xmin) * width);
  const cropH = Math.round((crop.ymax - crop.ymin) * height);

  const cropped = await sharp(Buffer.from(data))
    .extract({ left, top, width: cropW, height: cropH })
    .png()
    .toBuffer();

  return { data: cropped, width: cropW, height: cropH };
}

/**
 * Create a VLM OpenRouter plugin.
 *
 * Reads `pages:images` artifact (set by pymupdf or google-ocr with extractImages).
 * Sets `vlm:call` artifact — a handler function consumed by QueryResult.vlm().
 */
export function vlmOpenRouter(config: VLMOpenRouterConfig = {}): PDFQueryPlugin {
  const {
    apiKey = process.env.OPENROUTER_API_KEY,
    model = 'qwen/qwen3-vl-235b-a22b-instruct',
    maxTokens = 2048,
  } = config;

  return {
    name: 'vlm-openrouter',
    async run(ctx) {
      if (!apiKey) {
        throw new Error('vlm-openrouter: OPENROUTER_API_KEY not set');
      }

      const handler = async (images: VLMImage[], prompt: string): Promise<string> => {
        const imageContent = await Promise.all(images.map(async ({ image: img, crop }) => {
          let buf: Buffer<ArrayBufferLike> = Buffer.from(img.data);

          // Draw bounding box highlight on full page (additive, not destructive)
          if (crop) {
            buf = await highlightRegion(img.data, img.width, img.height, crop);
          }

          const base64 = buf.toString('base64');
          const dataUri = `data:image/png;base64,${base64}`;
          return {
            type: 'image_url' as const,
            image_url: { url: dataUri },
          };
        }));

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages: [
              {
                role: 'user',
                content: [
                  ...imageContent,
                  { type: 'text', text: prompt },
                ],
              },
            ],
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`vlm-openrouter: ${response.status} ${body.slice(0, 200)}`);
        }

        const data = await response.json() as {
          choices: Array<{ message: { content: string } }>;
        };

        return data.choices[0]?.message?.content ?? '';
      };

      ctx.artifacts.set('vlm:call', handler);

      ctx.emit('vlm-openrouter:ready', { model });
      return {};
    },
  };
}
