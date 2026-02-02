/**
 * Live test: OCR (pymupdf) + VLM bbox detection against OpenRouter.
 *
 * Extracts a single page, runs pymupdf + VLM bbox detect, compares results.
 *
 * Usage:
 *   bun run scripts/vlm-bbox-detect-live.ts [pdf-path] [page]
 */

import { config } from 'dotenv';
config({ path: `${process.env.HOME}/dev/apikeys/.env` });
import { mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import pdfquery from '../src/session';
import type { QueryResult } from '../src/query';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';
import { vlmOpenRouter, highlightRegion } from '../pdfquery-plugins/src/vlm-openrouter';
import { vlmBboxDetect } from '../pdfquery-plugins/src/vlm-bbox-detect';
import { ARTIFACT_KEYS } from '../pdfquery-plugins/src';
import type { PageImage } from '../pdfquery-plugins/src/types';
import sharp from 'sharp';

/** Composite styled selections onto a page image. Consumer-side helper. */
async function renderOverlay(
  pageImage: PageImage,
  selections: QueryResult[],
): Promise<Buffer> {
  let buf = Buffer.from(pageImage.data);
  for (const sel of selections) {
    const css = sel.getCss();
    for (const el of sel.elements) {
      if (el.pageIndex !== pageImage.page - 1) continue;
      buf = await highlightRegion(buf, pageImage.width, pageImage.height, el.bbox, {
        stroke: (css.borderColor as string) ?? '#ff0000',
        strokeWidth: (css.borderWidth as number) ?? 3,
        fill: (css.fill as string) ?? 'rgba(255,0,0,0.08)',
      });
    }
  }
  return buf;
}

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/vlm-bbox-detect-live.ts <pdf-path> [page]'); process.exit(1); }
const targetPage = parseInt(process.argv[3] || '6');
const outDir = join(import.meta.dirname, '..', 'scripts', 'bbox-detect-output');
mkdirSync(outDir, { recursive: true });

function iou(
  a: { xmin: number; ymin: number; xmax: number; ymax: number },
  b: { xmin: number; ymin: number; xmax: number; ymax: number },
): number {
  const ix1 = Math.max(a.xmin, b.xmin), iy1 = Math.max(a.ymin, b.ymin);
  const ix2 = Math.min(a.xmax, b.xmax), iy2 = Math.min(a.ymax, b.ymax);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const union = (a.xmax - a.xmin) * (a.ymax - a.ymin) + (b.xmax - b.xmin) * (b.ymax - b.ymin) - inter;
  return union > 0 ? inter / union : 0;
}

/** Extract a single page into a temp PDF to avoid rasterizing all 48 pages */
function extractOnePage(src: string, page: number): string {
  const dest = join(outDir, `_page_${page}.pdf`);
  const absSrc = src.startsWith('/') ? src : join(process.cwd(), src);
  execSync(`python3 -c "
import pymupdf
doc = pymupdf.open('${absSrc}')
out = pymupdf.open()
out.insert_pdf(doc, from_page=${page - 1}, to_page=${page - 1})
out.save('${dest}')
out.close(); doc.close()
"`);
  return dest;
}

async function main() {
  console.log(`Source: ${pdfPath}, page ${targetPage}`);

  // Extract just the one page → 1-page PDF
  const onePage = extractOnePage(pdfPath, targetPage);
  console.log(`Extracted page ${targetPage} → ${onePage}`);

  // Pipeline: pymupdf (native text+tables) → vlmOpenRouter → vlmBboxDetect
  const t0 = Date.now();
  const session = pdfquery();
  session.use(pymupdf({ pdf: { type: 'path', path: onePage }, extractImages: true }) as any);
  session.use(vlmOpenRouter() as any);
  session.use(vlmBboxDetect({ types: ['table', 'figure'] }) as any);

  // Debug listeners
  session.on('vlm-bbox-detect:page-start', (_cb: any, data: any) => console.log(`  [vlm] page ${data.page} starting (${data.index + 1}/${data.total})...`));
  session.on('vlm-bbox-detect:page-done', (_cb: any, data: any) => console.log(`  [vlm] page ${data.page} done in ${data.ms}ms (${data.chars} chars)`));
  session.on('vlm-bbox-detect:raw', (_cb: any, data: any) => console.log(`  [vlm] raw response:\n${data.response}\n`));
  session.on('vlm-bbox-detect:parsed', (_cb: any, data: any) => console.log(`  [vlm] parsed ${data.count} detections`));
  session.on('vlm-bbox-detect:invalid', (_cb: any, data: any) => console.log(`  [vlm] INVALID bbox on page ${data.page}:`, JSON.stringify(data.detection)));
  session.on('vlm-bbox-detect:done', (_cb: any, data: any) => console.log(`  [vlm] total: ${data.count} tags`));

  const doc = await session.load();
  console.log(`Pipeline loaded in ${Date.now() - t0}ms\n`);

  const $ = doc.$;
  const pageImages = doc.artifacts.get(ARTIFACT_KEYS.PAGE_IMAGES) as PageImage[];

  // Note: pymupdf doesn't set source attr → meta.source defaults to 'system'
  const pdfTables = $('table').not('[source=vlm-bbox]');
  const vlmTables = $('table[source=vlm-bbox]');
  const vlmFigures = $('figure[source=vlm-bbox]');

  console.log('=== Summary ===');
  console.log(`PDF-extracted tables: ${pdfTables.count()}`);
  console.log(`VLM-detected tables: ${vlmTables.count()}`);
  console.log(`VLM-detected figures: ${vlmFigures.count()}`);
  console.log(`Combined $('table').count() = ${$('table').count()}`);
  console.log();

  // --- PDF tables detail ---
  console.log('--- PDF tables (red) ---');
  for (const e of pdfTables.elements) {
    console.log(`  #${e.id}  bbox=(${e.bbox.xmin.toFixed(3)},${e.bbox.ymin.toFixed(3)})-(${e.bbox.xmax.toFixed(3)},${e.bbox.ymax.toFixed(3)})  text="${(e.text || '').slice(0, 60)}..."`);
  }

  // --- VLM tables detail ---
  console.log('--- VLM tables (green) ---');
  for (const e of vlmTables.elements) {
    console.log(`  #${e.id}  bbox=(${e.bbox.xmin.toFixed(3)},${e.bbox.ymin.toFixed(3)})-(${e.bbox.xmax.toFixed(3)},${e.bbox.ymax.toFixed(3)})  conf=${e.meta.confidence}  text="${(e.text || '').slice(0, 60)}..."`);
  }

  // --- VLM figures detail ---
  console.log('--- VLM figures (blue) ---');
  for (const e of vlmFigures.elements) {
    console.log(`  #${e.id}  bbox=(${e.bbox.xmin.toFixed(3)},${e.bbox.ymin.toFixed(3)})-(${e.bbox.xmax.toFixed(3)},${e.bbox.ymax.toFixed(3)})  text="${(e.text || '').slice(0, 60)}..."`);
  }

  // --- IoU matrix ---
  if (pdfTables.count() > 0 && vlmTables.count() > 0) {
    console.log('\n--- IoU matrix (PDF rows × VLM cols) ---');
    const vlmIds = vlmTables.elements.map(e => e.id.slice(0, 20));
    console.log(`${''.padEnd(22)}${vlmIds.map(id => id.padEnd(12)).join('')}`);
    for (const pdfE of pdfTables.elements) {
      const ious = vlmTables.elements.map(vlmE => iou(pdfE.bbox, vlmE.bbox).toFixed(3).padEnd(12));
      console.log(`  ${pdfE.id.slice(0, 20).padEnd(20)}${ious.join('')}`);
    }
  }

  // --- Spatial: .near() ---
  if (pdfTables.count() > 0) {
    const nearby = pdfTables.near(0.15);
    const nearbyVlm = nearby.filter('[source=vlm-bbox]');
    console.log(`\n.near(0.15) from PDF tables → ${nearbyVlm.count()} VLM entities nearby`);
  }

  // --- Save annotated image ---
  const pageImg = pageImages[0]; // only 1 page
  if (pageImg) {
    const buf = await renderOverlay(pageImg, [
      pdfTables.css({ borderColor: '#ff0000', fill: 'rgba(255,0,0,0.06)' }),
      vlmTables.css({ borderColor: '#00cc00', fill: 'rgba(0,200,0,0.06)' }),
      vlmFigures.css({ borderColor: '#0066ff', borderWidth: 2, fill: 'rgba(0,100,255,0.06)' }),
    ]);

    const outPath = join(outDir, `page${targetPage}-overlay.png`);
    await sharp(buf).toFile(outPath);
    console.log(`\nSaved: ${outPath}  (red=PDF, green=VLM table, blue=VLM figure)`);
  }

  console.log('\n=== jQuery-style queries ===');
  console.log(`$('table').count()                         = ${$('table').count()}`);
  console.log(`$('table').not('[source=vlm-bbox]').count() = ${$('table').not('[source=vlm-bbox]').count()}`);
  console.log(`$('table[source=vlm-bbox]').count()         = ${$('table[source=vlm-bbox]').count()}`);
  console.log(`$('*').not('page').countByType():`);
  const counts = $('*').not('page').countByType();
  for (const [type, count] of counts) {
    console.log(`  ${type}: ${count}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
