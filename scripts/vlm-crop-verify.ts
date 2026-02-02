/**
 * Verify VLM crop isolation: find a page with multiple tables,
 * fire a vlm call per table, confirm each only sees its own table.
 *
 * Usage:
 *   source ~/dev/apikeys/.env && bun run scripts/vlm-crop-verify.ts
 */

import { config } from 'dotenv';
import pdfquery from '../src/session';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';
import { vlmOpenRouter } from '../pdfquery-plugins/src/vlm-openrouter';

config({ path: `${process.env.HOME}/dev/apikeys/.env` });

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/vlm-crop-verify.ts <path-to-pdf>'); process.exit(1); }

async function main() {
  console.log(`Loading: ${pdfPath}\n`);

  const doc = await pdfquery.load([
    pymupdf({ pdf: { type: 'path', path: pdfPath }, extractImages: true }),
    vlmOpenRouter(),
  ]);

  const $ = doc.$;

  // Find pages with 2+ tables
  const tablesByPage = new Map<number, ReturnType<typeof $>>();
  const allTables = $('table');
  for (const t of allTables.elements) {
    const page = t.pageIndex + 1;
    if (!tablesByPage.has(page)) {
      tablesByPage.set(page, $('table').onPage(page));
    }
  }

  const multiTablePages = [...tablesByPage.entries()]
    .filter(([, sel]) => sel.count() >= 2)
    .sort((a, b) => b[1].count() - a[1].count());

  if (multiTablePages.length === 0) {
    console.log('No pages with multiple tables found.');
    return;
  }

  // Pick the page with most tables
  const [targetPage, tables] = multiTablePages[0];
  console.log(`Page ${targetPage} has ${tables.count()} tables — perfect for isolation test.\n`);

  // Show each table's bbox
  for (let i = 0; i < tables.count(); i++) {
    const el = tables.elements[i];
    const bbox = el.bbox;
    console.log(`  Table ${i + 1}: y=${bbox.ymin.toFixed(2)}–${bbox.ymax.toFixed(2)} | text preview: "${el.text.slice(0, 60)}..."`);
  }
  console.log();

  // Fire VLM on each table individually with margin for safety
  for (let i = 0; i < tables.count(); i++) {
    const sel = tables.eq(i);
    const el = sel.elements[0];
    console.log(`--- Table ${i + 1} (page ${targetPage}, y=${el.bbox.ymin.toFixed(2)}–${el.bbox.ymax.toFixed(2)}) ---`);
    console.log(`  OCR text: "${el.text.slice(0, 100)}"`);

    const answer = await sel.css({ margin: 20 }).vlm(
      'What is this table about? List its column headers and first data row. Be concise — max 2 sentences.'
    );
    console.log(`  VLM: ${answer.trim().replace(/\n/g, '\n       ')}`);
    console.log();
  }

  console.log('Done — if each answer describes a different table, crop isolation is working.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
