/**
 * PyMuPDF local extraction plugin.
 *
 * Spawns a Python subprocess that uses PyMuPDF (fitz) to extract:
 *   - Text blocks with normalized bboxes → ocr tags
 *   - Tables with markdown + bboxes → table tags
 *   - TOC entries → heading tags
 *   - Page images (optional) → PageImage[] artifact for VLM plugins
 *
 * Zero network calls. Requires: `pip install pymupdf`
 *
 * Sets artifacts:
 *   - pdf:input     (PDFInput)
 *   - pages:images  (PageImage[]) — only if extractImages is true
 *   - ocr:pages     (OcrPage[])
 *   - toc:entries   (TocEntry[])
 */

import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PDFQueryPlugin, Tag, PageData } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { OcrPage, PageImage } from '../types';

// ============================================================================
// Config
// ============================================================================

export interface PyMuPDFConfig {
  /** PDF to process — file path or buffer */
  pdf: { type: 'path'; path: string } | { type: 'buffer'; data: Buffer | Uint8Array };
  /** Python executable (default: 'python3') */
  pythonPath?: string;
  /** Rasterize pages to PNG for VLM plugins (default: false) */
  extractImages?: boolean;
  /** DPI for page images (default: 150) */
  imagesDpi?: number;
  /** Extract tables (default: true) */
  extractTables?: boolean;
  /** Extract TOC (default: true) */
  extractToc?: boolean;
}

// ============================================================================
// Script output shape
// ============================================================================

interface PyMuPDFBlock {
  id: string;
  page: number;
  text: string;
  bbox: [number, number, number, number]; // [x, y, width, height] normalized
  confidence: number;
  type: string;
}

interface PyMuPDFTable {
  id: string;
  page: number;
  markdown: string;
  bbox: [number, number, number, number];
  cells: number;
  rows: number;
  cols: number;
}

interface PyMuPDFTocEntry {
  level: number;
  title: string;
  page: number;
}

interface PyMuPDFImage {
  page: number;
  path: string;
  width: number;
  height: number;
  mimeType: 'image/png';
}

interface PyMuPDFPageInfo {
  page: number;
  width: number;
  height: number;
}

interface PyMuPDFOutput {
  pages: PyMuPDFPageInfo[];
  blocks: PyMuPDFBlock[];
  tables: PyMuPDFTable[];
  toc: PyMuPDFTocEntry[];
  images: PyMuPDFImage[];
  totalPages: number;
  elapsedMs: number;
  error?: string;
}

// ============================================================================
// Well-known artifact keys (extending core set)
// ============================================================================

export const PYMUPDF_ARTIFACT_KEYS = {
  TOC_ENTRIES: 'toc:entries',
} as const;

export interface TocEntry {
  level: number;
  title: string;
  page: number;
}

// ============================================================================
// Conversion helpers
// ============================================================================

function blocksToTags(blocks: PyMuPDFBlock[]): Tag[] {
  return blocks.map(b => ({
    id: b.id,
    type: 'ocr' as const,
    page: b.page,
    bbox: { x: b.bbox[0], y: b.bbox[1], width: b.bbox[2], height: b.bbox[3] },
    text: b.text,
    attrs: { confidence: b.confidence },
  }));
}

function tablesToTags(tables: PyMuPDFTable[]): Tag[] {
  return tables.map(t => ({
    id: t.id,
    type: 'table' as const,
    page: t.page,
    bbox: { x: t.bbox[0], y: t.bbox[1], width: t.bbox[2], height: t.bbox[3] },
    text: t.markdown,
    attrs: { cells: t.cells, rows: t.rows, cols: t.cols },
  }));
}

function tocToTags(entries: PyMuPDFTocEntry[]): Tag[] {
  return entries.map((e, i) => ({
    id: `toc-${i}`,
    type: 'heading' as const,
    page: e.page,
    // TOC entries don't have bboxes — use full-page placeholder
    bbox: { x: 0, y: 0, width: 1, height: 0 },
    text: e.title,
    attrs: { level: e.level, source: 'toc' },
  }));
}

function blocksToOcrPages(blocks: PyMuPDFBlock[]): OcrPage[] {
  const pageMap = new Map<number, OcrPage>();
  for (const b of blocks) {
    if (!pageMap.has(b.page)) {
      pageMap.set(b.page, { page: b.page, blocks: [], tables: [] });
    }
    pageMap.get(b.page)!.blocks.push({
      id: b.id,
      page: b.page,
      text: b.text,
      bbox: { x: b.bbox[0], y: b.bbox[1], width: b.bbox[2], height: b.bbox[3] },
      confidence: b.confidence,
      type: 'paragraph',
    });
  }
  return Array.from(pageMap.values()).sort((a, b) => a.page - b.page);
}

function pagesToPageData(pages: PyMuPDFPageInfo[]): PageData[] {
  return pages.map(p => ({
    pageNumber: p.page,
    width: p.width,
    height: p.height,
  }));
}

// ============================================================================
// Subprocess runner
// ============================================================================

function getScriptPath(): string {
  // Works in both ESM and CJS contexts
  const thisDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, '..', '..', 'scripts', 'pymupdf_extract.py');
}

function runPython(
  pythonPath: string,
  args: string[],
): Promise<PyMuPDFOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`pymupdf_extract.py exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) {
          reject(new Error(`pymupdf: ${parsed.error}`));
          return;
        }
        resolve(parsed as PyMuPDFOutput);
      } catch {
        reject(new Error(`pymupdf: failed to parse output: ${stdout.slice(0, 200)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`pymupdf: failed to spawn python: ${err.message}`));
    });
  });
}

// ============================================================================
// Plugin factory
// ============================================================================

/**
 * Create a PyMuPDF local extraction plugin.
 *
 * Requires `pip install pymupdf` on the host.
 *
 * @example
 * ```ts
 * const doc = await pdfquery.load([
 *   pymupdf({ pdf: { type: 'path', path: './report.pdf' } })
 * ]);
 * doc.$('table').count();
 * doc.$('heading').texts(); // TOC entries
 * doc.$('ocr').onPage(1).texts();
 * ```
 */
export function pymupdf(config: PyMuPDFConfig): PDFQueryPlugin {
  return {
    name: 'pymupdf',
    async run(ctx) {
      const pythonPath = config.pythonPath ?? 'python3';
      const scriptPath = getScriptPath();
      let tmpDir: string | null = null;
      let pdfPath: string;

      // Resolve PDF path — write buffer to temp file if needed
      if (config.pdf.type === 'path') {
        pdfPath = config.pdf.path;
      } else {
        tmpDir = await mkdtemp(join(tmpdir(), 'pdfquery-'));
        pdfPath = join(tmpDir, 'input.pdf');
        await writeFile(pdfPath, config.pdf.data);
      }

      try {
        // Build args
        const args = [scriptPath, pdfPath];
        if (config.extractTables === false) args.push('--no-tables');
        if (config.extractToc === false) args.push('--no-toc');

        let imagesDir: string | null = null;
        if (config.extractImages) {
          imagesDir = tmpDir ?? await mkdtemp(join(tmpdir(), 'pdfquery-imgs-'));
          if (!tmpDir) tmpDir = imagesDir; // track for cleanup
          args.push('--images-dir', join(imagesDir, 'images'));
          args.push('--dpi', String(config.imagesDpi ?? 150));
        }

        ctx.emit('pymupdf:start', { pdfPath });

        // Run extraction
        const output = await runPython(pythonPath, args);

        // Set artifacts
        ctx.artifacts.set(ARTIFACT_KEYS.PDF_INPUT, config.pdf);

        const ocrPages = blocksToOcrPages(output.blocks);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);

        if (output.toc.length > 0) {
          ctx.artifacts.set(PYMUPDF_ARTIFACT_KEYS.TOC_ENTRIES, output.toc as TocEntry[]);
        }

        // Load page images into memory if extracted
        let pageImages: PageImage[] = [];
        if (output.images.length > 0) {
          pageImages = await Promise.all(
            output.images.map(async (img) => ({
              page: img.page,
              data: await readFile(img.path),
              mimeType: img.mimeType as 'image/png',
              width: img.width,
              height: img.height,
            }))
          );
          ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
        }

        // Build tags
        const tags: Tag[] = [
          ...blocksToTags(output.blocks),
          ...tablesToTags(output.tables),
          ...tocToTags(output.toc),
        ];

        ctx.emit('pymupdf:complete', {
          totalPages: output.totalPages,
          blocks: output.blocks.length,
          tables: output.tables.length,
          tocEntries: output.toc.length,
          images: pageImages.length,
          elapsedMs: output.elapsedMs,
        });

        return {
          tags,
          data: {
            pages: pagesToPageData(output.pages),
            elapsedMs: output.elapsedMs,
          },
        };
      } finally {
        // Cleanup temp files
        if (tmpDir) {
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },
  };
}
