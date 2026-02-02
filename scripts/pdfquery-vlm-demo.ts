/**
 * Demo: VLM queries on PDF pages/tables via OpenRouter
 *
 * Usage:
 *   source ~/dev/apikeys/.env && bun run scripts/pdfquery-vlm-demo.ts [path-to-pdf]
 */

import { config } from 'dotenv';
import pdfquery from '../src/session';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';
import { vlmOpenRouter } from '../pdfquery-plugins/src/vlm-openrouter';

// Load API keys from ~/dev/apikeys/.env
config({ path: `${process.env.HOME}/dev/apikeys/.env` });

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/pdfquery-vlm-demo.ts <path-to-pdf>'); process.exit(1); }

async function main() {
  console.log(`\nLoading: ${pdfPath} (with page images)\n`);

  const doc = await pdfquery.load([
    pymupdf({ pdf: { type: 'path', path: pdfPath }, extractImages: true }),
    vlmOpenRouter(),
  ]);

  const $ = doc.$;
  console.log(`Loaded: ${$('*').count()} entities, ${$('page').count()} pages, ${$('table').count()} tables\n`);

  // --- Query 1: What is page 1 about? ---
  console.log('=== Query 1: $("page:first").vlm("what is this page about?") ===');
  const q1 = await $('page:first').vlm('What is this page about? Give a 2-3 sentence summary.');
  console.log(q1);
  console.log();

  // --- Query 2: First table ---
  const tableCount = $('table').count();
  if (tableCount > 0) {
    const firstTablePage = $('table:first').first()!.pageIndex + 1;
    console.log(`=== Query 2: $("table").onPage(${firstTablePage}).vlm("extract all dollar amounts") ===`);
    const q2 = await $('table').onPage(firstTablePage).vlm('Extract all dollar amounts from this table. List each one.');
    console.log(q2);
  } else {
    console.log('=== Query 2: No tables found — skipping ===');
  }
  console.log();

  // --- Query 3: Revenue blocks ---
  const revBlocks = $('ocr').contains('revenue');
  if (revBlocks.count() > 0) {
    console.log(`=== Query 3: $("ocr").contains("revenue").eq(0).vlm("what revenue figure?") (${revBlocks.count()} matches) ===`);
    const q3 = await revBlocks.eq(0).vlm('What revenue figure is shown here? State the exact number.');
    console.log(q3);
  } else {
    console.log('=== Query 3: No OCR blocks containing "revenue" — skipping ===');
  }

  console.log('\nDone\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
