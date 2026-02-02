/**
 * Quick TOC: scan a PDF with pymupdf and print what's on each page.
 *
 * Usage: bun run scripts/toc.ts <pdf-path>
 */

import { config } from 'dotenv';
config({ path: `${process.env.HOME}/dev/apikeys/.env` });

import pdfquery from '../src/session';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/toc.ts <pdf>'); process.exit(1); }

async function main() {
  const doc = await pdfquery.load([
    pymupdf({ pdf: { type: 'path', path: pdfPath } }),
  ]);
  const $ = doc.$;

  const totalPages = $('page').count();
  console.log(`${pdfPath}\n${totalPages} pages, ${$('*').count()} entities\n`);

  const counts = $('*').not('page').countByType();
  console.log('Totals:', [...counts.entries()].map(([t, c]) => `${t}:${c}`).join('  '));
  console.log();

  for (let p = 1; p <= totalPages; p++) {
    const onPage = $('*').not('page').onPage(p);
    const tables = $('table').onPage(p).count();
    const ocr = $('ocr').onPage(p).count();
    const firstText = $('ocr').onPage(p).text()?.slice(0, 80) || '';
    const marker = tables > 0 ? ` [${tables} TABLE${tables > 1 ? 'S' : ''}]` : '';
    console.log(`  p${String(p).padStart(2)}  ${String(onPage.count()).padStart(3)} entities${marker}  ${firstText}`);
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
