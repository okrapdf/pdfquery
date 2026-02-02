/**
 * Quick demo: .css() + .getCss() → highlightRegion on real PDF page.
 * Usage: bun run scripts/render-overlay-demo.ts
 */
import sharp from 'sharp';
import 'dotenv/config';
import { mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import pdfquery from '../src/session';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';
import { vlmOpenRouter, highlightRegion } from '../pdfquery-plugins/src/vlm-openrouter';
import { vlmBboxDetect } from '../pdfquery-plugins/src/vlm-bbox-detect';
import { ARTIFACT_KEYS } from '../pdfquery-plugins/src';
import type { PageImage } from '../pdfquery-plugins/src/types';

const outDir = join(import.meta.dirname, '..', 'scripts', 'bbox-detect-output');
mkdirSync(outDir, { recursive: true });

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/render-overlay-demo.ts <path-to-pdf>'); process.exit(1); }
const targetPage = parseInt(process.argv[3] || '6');
const dest = join(outDir, `_page_${targetPage}.pdf`);
const absSrc = pdfPath.startsWith('/') ? pdfPath : join(process.cwd(), pdfPath);
execSync(`python3 -c "
import pymupdf
doc = pymupdf.open('${absSrc}')
out = pymupdf.open()
out.insert_pdf(doc, from_page=${targetPage - 1}, to_page=${targetPage - 1})
out.save('${dest}')
out.close(); doc.close()
"`);

async function main() {
  const session = pdfquery();
  session.use(pymupdf({ pdf: { type: 'path', path: dest }, extractImages: true }) as any);
  session.use(vlmOpenRouter({ model: 'qwen/qwen3-vl-235b-a22b-instruct' }) as any);
  session.use(vlmBboxDetect({ types: ['table', 'figure'] }) as any);

  session.on('vlm-bbox-detect:page-done', (_cb: any, data: any) => console.log(`  [vlm] page ${data.page} done in ${data.ms}ms`));
  session.on('vlm-bbox-detect:raw', (_cb: any, data: any) => console.log(`  [vlm] raw:\n${data.response.slice(0, 500)}`));
  session.on('vlm-bbox-detect:done', (_cb: any, data: any) => console.log(`  [vlm] ${data.count} tags`));

  const doc = await session.load();

  const pageImages = doc.artifacts.get(ARTIFACT_KEYS.PAGE_IMAGES) as PageImage[];
  const pageImg = pageImages[0];
  console.log(`Page: ${pageImg.width}x${pageImg.height}`);

  const $ = doc.$;
  const pdfTables = $('table').not('[source=vlm-bbox]');
  const vlmTables = $('table[source=vlm-bbox]');
  const vlmFigures = $('figure[source=vlm-bbox]');
  console.log(`PDF tables: ${pdfTables.count()}, VLM tables: ${vlmTables.count()}, VLM figures: ${vlmFigures.count()}`);

  // .css() + .getCss() → highlightRegion
  const selections = [
    pdfTables.css({ borderColor: '#ff0000', fill: 'rgba(255,0,0,0.08)' }),
    vlmTables.css({ borderColor: '#00cc00', fill: 'rgba(0,200,0,0.06)' }),
    vlmFigures.css({ borderColor: '#0066ff', borderWidth: 2, fill: 'rgba(0,100,255,0.06)' }),
  ];

  let buf = Buffer.from(pageImg.data);
  for (const sel of selections) {
    const css = sel.getCss();
    for (const el of sel.elements) {
      buf = await highlightRegion(buf, pageImg.width, pageImg.height, el.bbox, {
        stroke: (css.borderColor as string) ?? '#ff0000',
        strokeWidth: (css.borderWidth as number) ?? 3,
        fill: (css.fill as string) ?? 'rgba(255,0,0,0.08)',
      });
    }
  }

  const outPath = join(outDir, 'css-overlay-demo.png');
  await sharp(buf).toFile(outPath);
  console.log(`Saved: ${outPath}  (red=PDF, green=VLM table, blue=VLM figure)`);
}

main().catch(e => { console.error(e); process.exit(1); });
