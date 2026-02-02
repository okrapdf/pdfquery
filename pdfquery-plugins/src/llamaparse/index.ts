/**
 * LlamaParse plugin — parse PDFs via LlamaIndex Cloud API (JSON rich mode).
 *
 * Upload → poll → fetch JSON result → map items/layout/ocr into Tags.
 *
 * Three data layers from LlamaParse JSON response:
 *
 *   items[]         Structured elements with text + bbox (PDF points).
 *                   Types: heading, text, table. This is the primary source.
 *
 *   layout[]        Layout detections with higher confidence + 0-1 bboxes.
 *                   Used to enrich items (better confidence) and add elements
 *                   LlamaParse items missed (e.g. pictures).
 *
 *   images[].ocr[]  Word-level OCR from embedded images (pixel coords).
 *                   Optional — behind `includeWordOcr` flag.
 *
 * Bbox normalization follows the pdfquery/okrapdf convention:
 *   items.bBox:  PDF points → ÷ page.width/height → 0-1
 *   layout.bbox: already 0-1
 *   ocr coords:  image pixels → page points → 0-1
 *   All go through core normalizeBbox() + clampBbox().
 *
 * Sets artifacts:
 *   - pdf:input        (PDFInput)
 *   - ocr:pages        (OcrPage[])
 *   - markdown:pages   (MarkdownPage[])
 */

import { readFile } from 'node:fs/promises';
import type { PDFQueryPlugin, Tag, BBox } from 'pdfquery';
import { normalizeBbox, clampBbox } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { OcrPage, OcrBlock } from '../types';

// ============================================================================
// Config
// ============================================================================

export interface LlamaParseConfig {
  /** PDF to process — file path or buffer */
  pdf: { type: 'path'; path: string } | { type: 'buffer'; data: Buffer | Uint8Array; fileName?: string };
  /** LlamaIndex Cloud API key — defaults to process.env.LLAMAINDEX_API_KEY */
  apiKey?: string;
  /** API base URL (default: https://api.cloud.llamaindex.ai) */
  apiBase?: string;
  /** Poll interval in ms (default: 2000) */
  pollIntervalMs?: number;
  /** Max wait time in ms (default: 300000 = 5min) */
  timeoutMs?: number;
  /** Target specific pages: "1,3,5-10" */
  targetPages?: string;
  /** Defer extraction to getter time (.markdown()). Registers handler at load, extracts on access. */
  defer?: boolean;
  /** Include word-level OCR from embedded images (default: false) */
  includeWordOcr?: boolean;
  /** Include layout[] detections as separate tags (default: true) */
  includeLayout?: boolean;
  /** Take page screenshots (default: true, needed for VLM) */
  takeScreenshot?: boolean;
}

// ============================================================================
// LlamaParse response types (from SDK + fixture analysis)
// ============================================================================

interface LPBBox {
  x: number; y: number; w: number; h: number;
  confidence?: number; label?: string;
}

interface LPPageItem {
  type: string;         // 'heading' | 'text' | 'table'
  value?: string;
  md?: string;
  lvl?: number;         // heading level 1-6
  rows?: string[][];    // table 2D array
  csv?: string;
  isPerfectTable?: boolean;
  html?: string;
  bBox?: LPBBox;
}

interface LPLayoutItem {
  image: string;
  confidence: number;
  label: string;        // 'table' | 'text' | 'listItem' | 'sectionHeader' | 'picture'
  bbox: { x: number; y: number; w: number; h: number };
  isLikelyNoise: boolean;
}

interface LPOcrWord {
  x: number; y: number; w: number; h: number;
  confidence: number; text: string;
}

interface LPImage {
  name: string;
  height: number; width: number;
  x: number; y: number;
  original_width: number; original_height: number;
  rotation?: number;
  type?: string;        // 'full_page_screenshot' | 'layout_table' | ...
  ocr?: LPOcrWord[];
}

interface LPPage {
  page: number;
  text?: string;
  md?: string;
  width: number;        // PDF points (e.g. 612)
  height: number;       // PDF points (e.g. 792)
  confidence?: number;
  status?: string;
  items: LPPageItem[];
  layout: LPLayoutItem[];
  images: LPImage[];
  charts: unknown[];
}

interface LPJsonResult {
  pages: LPPage[];
  job_metadata: Record<string, unknown>;
}

// ============================================================================
// Markdown page artifact type
// ============================================================================

export interface MarkdownPage {
  page: number;
  markdown: string;
}

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Normalize items bBox (PDF points) to 0-1 using page dimensions */
function normalizeItemBbox(b: LPBBox, pageW: number, pageH: number): BBox | null {
  return normalizeBbox({ x: b.x / pageW, y: b.y / pageH, width: b.w / pageW, height: b.h / pageH });
}

/** Normalize layout bbox — already 0-1 but in {x,y,w,h} format */
function normalizeLayoutBbox(b: { x: number; y: number; w: number; h: number }): BBox | null {
  return normalizeBbox({ x: b.x, y: b.y, width: b.w, height: b.h });
}

/** Normalize OCR word coords (image pixels) to 0-1 page coords */
function normalizeOcrBbox(
  ocr: LPOcrWord,
  img: LPImage,
  pageW: number, pageH: number,
): BBox | null {
  const nx = (img.x + ocr.x * (img.width / img.original_width)) / pageW;
  const ny = (img.y + ocr.y * (img.height / img.original_height)) / pageH;
  const nw = (ocr.w * (img.width / img.original_width)) / pageW;
  const nh = (ocr.h * (img.height / img.original_height)) / pageH;
  return normalizeBbox({ x: nx, y: ny, width: nw, height: nh });
}

/** Map LlamaParse item type → pdfquery Tag type */
function mapItemType(lpType: string): string {
  switch (lpType) {
    case 'heading': return 'heading';
    case 'table': return 'table';
    case 'text': return 'ocr';
    default: return 'ocr';
  }
}

/** Map LlamaParse layout label → pdfquery Tag type */
function mapLayoutLabel(label: string): string {
  switch (label) {
    case 'table': return 'table';
    case 'picture': return 'figure';
    case 'sectionHeader': return 'heading';
    case 'listItem': return 'ocr';
    case 'text': return 'ocr';
    default: return 'ocr';
  }
}

/** Simple bbox overlap check (IoU > 0) */
function bboxOverlaps(a: BBox, b: BBox): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

// ============================================================================
// Upload / Poll / Fetch — reusable for both eager and lazy paths
// ============================================================================

async function uploadAndParse(
  pdf: LlamaParseConfig['pdf'],
  opts: {
    apiKey: string;
    apiBase: string;
    pollIntervalMs: number;
    timeoutMs: number;
    targetPages?: string;
    takeScreenshot: boolean;
    emit: (event: string, data?: unknown) => void;
  },
): Promise<LPJsonResult> {
  const { apiKey, apiBase, pollIntervalMs, timeoutMs, targetPages, takeScreenshot, emit } = opts;

  // ── 1. Upload ────────────────────────────────────────────────────
  const formData = new FormData();
  let fileBlob: Blob;
  let fileName: string;
  if (pdf.type === 'path') {
    const data = await readFile(pdf.path);
    fileBlob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
    fileName = pdf.path.split('/').pop() || 'document.pdf';
  } else {
    fileBlob = new Blob([new Uint8Array(pdf.data)], { type: 'application/pdf' });
    fileName = pdf.fileName || 'document.pdf';
  }
  formData.append('file', fileBlob, fileName);
  formData.append('extract_layout', 'true');
  if (takeScreenshot) formData.append('take_screenshot', 'true');
  if (targetPages) formData.append('target_pages', targetPages);

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
  emit('llamaparse:uploaded', { jobId, targetPages });

  // ── 2. Poll ──────────────────────────────────────────────────────
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    emit('llamaparse:polling', { jobId });
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

  // ── 3. Fetch JSON result ─────────────────────────────────────────
  const resultRes = await fetch(`${apiBase}/api/parsing/job/${jobId}/result/json`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resultRes.ok) throw new Error(`llamaparse result fetch failed: ${resultRes.status}`);
  emit('llamaparse:done', { jobId });
  return await resultRes.json() as LPJsonResult;
}

// ============================================================================
// Plugin
// ============================================================================

export function llamaParse(config: LlamaParseConfig): PDFQueryPlugin {
  const {
    apiKey = process.env.LLAMAINDEX_API_KEY,
    apiBase = 'https://api.cloud.llamaindex.ai',
    pollIntervalMs = 2000,
    timeoutMs = 300_000,
    targetPages,
    defer = false,
    includeWordOcr = false,
    includeLayout = true,
    takeScreenshot = true,
  } = config;

  return {
    name: 'llamaparse',
    async run(ctx) {
      if (!apiKey) throw new Error('llamaparse: LLAMAINDEX_API_KEY not set');
      ctx.emit('llamaparse:start');

      // ── Register markdown:call handler ─────────────────────────────
      // Extends QueryResult.markdown() — owns cache check + deferred extraction.
      // Same pattern as vlmOpenRouter setting vlm:call.
      const markdownHandler = async (pages: number[], opts: { force: boolean }): Promise<string | null> => {
        // 1. Check markdown:pages cache
        if (!opts.force) {
          const mdPages = (ctx.artifacts.get(ARTIFACT_KEYS.MARKDOWN_PAGES) as MarkdownPage[] | undefined) ?? [];
          const matched = mdPages.filter(mp => pages.includes(mp.page));
          if (matched.length > 0) {
            return matched.map(mp => mp.markdown).join('\n\n');
          }
        }

        // 2. On-demand extraction for missing pages
        const pageSpec = pages.join(',');
        ctx.emit('llamaparse:extract', { pages: pageSpec });
        const json = await uploadAndParse(config.pdf, {
          apiKey: apiKey!,
          apiBase,
          pollIntervalMs,
          timeoutMs,
          targetPages: pageSpec,
          takeScreenshot,
          emit: ctx.emit,
        });
        const result = processJsonResult(json, ctx, { includeWordOcr, includeLayout });

        // Inject tags back into session
        const addTags = ctx.artifacts.get(ARTIFACT_KEYS.ADD_TAGS) as ((tags: Tag[]) => void) | undefined;
        if (addTags && result.tags.length > 0) {
          addTags(result.tags);
        }

        // Return markdown from this extraction
        const mdPages = (ctx.artifacts.get(ARTIFACT_KEYS.MARKDOWN_PAGES) as MarkdownPage[] | undefined) ?? [];
        const matched = mdPages.filter(mp => pages.includes(mp.page));
        return matched.length > 0 ? matched.map(mp => mp.markdown).join('\n\n') : null;
      };
      ctx.artifacts.set('markdown:call', markdownHandler);

      // ── Deferred mode: register handler only, skip eager extraction ─
      if (defer) {
        ctx.emit('llamaparse:deferred');
        return { tags: [] };
      }

      const json = await uploadAndParse(config.pdf, {
        apiKey: apiKey!,
        apiBase,
        pollIntervalMs,
        timeoutMs,
        targetPages,
        takeScreenshot,
        emit: ctx.emit,
      });

      return processJsonResult(json, ctx, { includeWordOcr, includeLayout });
    },
  };
}

/**
 * Process a LlamaParse JSON result into Tags + artifacts.
 * Exported so tests can call it directly with fixture data (no API).
 */
export function processJsonResult(
  json: LPJsonResult,
  ctx: { emit: (event: string, data?: unknown) => void; artifacts: Map<string, unknown> },
  opts: { includeWordOcr?: boolean; includeLayout?: boolean } = {},
): { tags: Tag[] } {
  const tags: Tag[] = [];
  const ocrPages: OcrPage[] = [];
  const markdownPages: MarkdownPage[] = [];

  for (const page of json.pages) {
    const pageNum = page.page;
    const pageW = page.width;
    const pageH = page.height;
    const blocks: OcrBlock[] = [];
    const itemBboxes: BBox[] = []; // track item bboxes for layout dedup

    // ── 4a. items[] → Tags (primary source) ────────────────────────
    for (let i = 0; i < page.items.length; i++) {
      const item = page.items[i];
      const id = `lp-${pageNum}-item-${i}`;
      const tagType = mapItemType(item.type);

      let bbox: BBox = { x: 0, y: 0, width: 1, height: 1 };
      if (item.bBox) {
        const normalized = normalizeItemBbox(item.bBox, pageW, pageH);
        if (normalized) bbox = clampBbox(normalized);
      }
      itemBboxes.push(bbox);

      const confidence = item.bBox?.confidence ?? (page.confidence ?? 0.7);

      if (item.type === 'table') {
        // Table: rich attrs
        tags.push({
          id,
          type: 'table',
          page: pageNum,
          bbox,
          text: item.md || '',
          attrs: {
            source: 'llamaparse',
            confidence,
            rows: item.rows,
            csv: item.csv,
            isPerfectTable: item.isPerfectTable,
            html: item.html,
            markdown: item.md,
          },
        });
      } else if (item.type === 'heading') {
        tags.push({
          id,
          type: 'heading',
          page: pageNum,
          bbox,
          text: item.value || '',
          attrs: {
            source: 'llamaparse',
            confidence,
            level: item.lvl,
            markdown: item.md,
          },
        });
      } else {
        // text → ocr
        tags.push({
          id,
          type: 'ocr',
          page: pageNum,
          bbox,
          text: item.value || item.md || '',
          attrs: {
            source: 'llamaparse',
            confidence,
            markdown: item.md,
          },
        });
      }

      // Also add to OcrPage blocks
      blocks.push({
        id,
        page: pageNum,
        text: item.value || item.md || '',
        bbox,
        confidence,
        type: 'paragraph',
      });
    }

    // ── 4b. layout[] enrichment ────────────────────────────────────
    if (opts.includeLayout !== false) {
      for (let i = 0; i < page.layout.length; i++) {
        const el = page.layout[i];
        if (el.isLikelyNoise) continue;

        const normalized = normalizeLayoutBbox(el.bbox);
        if (!normalized) continue;
        const bbox = clampBbox(normalized);

        // Skip layout elements that overlap existing item tags
        const overlapsItem = itemBboxes.some(ib => bboxOverlaps(ib, bbox));
        if (overlapsItem) continue;

        // This layout element has no corresponding item — add it (e.g. pictures)
        const tagType = mapLayoutLabel(el.label);
        const id = `lp-${pageNum}-layout-${i}`;

        tags.push({
          id,
          type: tagType,
          page: pageNum,
          bbox,
          text: '',
          attrs: {
            source: 'llamaparse-layout',
            confidence: el.confidence,
            layoutLabel: el.label,
            layoutImage: el.image,
          },
        });
      }
    }

    // ── 4c. images[].ocr[] → word-level OCR ────────────────────────
    if (opts.includeWordOcr) {
      for (const img of page.images) {
        // Skip full page screenshots and layout crops
        if (img.type === 'full_page_screenshot') continue;
        if (img.type?.startsWith('layout_')) continue;
        if (!img.ocr?.length) continue;

        for (let j = 0; j < img.ocr.length; j++) {
          const word = img.ocr[j];
          if (!word.text.trim()) continue;

          const normalized = normalizeOcrBbox(word, img, pageW, pageH);
          if (!normalized) continue;
          const bbox = clampBbox(normalized);
          const id = `lp-${pageNum}-ocr-${img.name}-${j}`;

          tags.push({
            id,
            type: 'ocr',
            page: pageNum,
            bbox,
            text: word.text,
            attrs: {
              source: 'llamaparse-ocr',
              confidence: word.confidence,
            },
          });

          blocks.push({
            id,
            page: pageNum,
            text: word.text,
            bbox,
            confidence: word.confidence,
            type: 'word',
          });
        }
      }
    }

    // ── 4d. page markdown artifact ─────────────────────────────────
    if (page.md) {
      markdownPages.push({ page: pageNum, markdown: page.md });
    }

    ocrPages.push({ page: pageNum, blocks, tables: [] });
  }

  // ── 5. Set artifacts ─────────────────────────────────────────────
  ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
  ctx.artifacts.set(ARTIFACT_KEYS.MARKDOWN_PAGES, markdownPages);

  ctx.emit('llamaparse:complete', {
    pages: ocrPages.length,
    tags: tags.length,
    markdownPages: markdownPages.length,
  });

  return { tags };
}
