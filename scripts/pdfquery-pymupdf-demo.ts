/**
 * Demo: pymupdf plugin → pdfquery.load() → query → HTML tree
 *
 * Usage: bun run scripts/pdfquery-pymupdf-demo.ts [path-to-pdf]
 */

import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import pdfquery from '../src/session';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';
import { serializeHTML } from '../pdfquery-plugins/src/serialize-html';

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/pdfquery-pymupdf-demo.ts <path-to-pdf>'); process.exit(1); }

async function main() {
  console.log(`\nLoading: ${pdfPath}\n`);

  const doc = await pdfquery.load([
    pymupdf({ pdf: { type: 'path', path: pdfPath } }),
  ]);

  const $ = doc.$;

  // --- Counts ---
  console.log('=== Counts ===');
  console.log(`  All entities:  ${$('*').count()}`);
  console.log(`  OCR blocks:    ${$('ocr').count()}`);
  console.log(`  Tables:        ${$('table').count()}`);
  console.log(`  TOC headings:  ${$('heading').count()}`);

  // --- TOC ---
  const tocEntries = doc.artifacts.get('toc:entries') as Array<{ level: number; title: string; page: number }> | undefined;
  if (tocEntries && tocEntries.length > 0) {
    console.log(`\n=== Table of Contents (${tocEntries.length} entries) ===`);
    for (const e of tocEntries.slice(0, 10)) {
      const indent = '  '.repeat(e.level);
      console.log(`${indent}[p.${e.page}] ${e.title}`);
    }
    if (tocEntries.length > 10) console.log(`  ... and ${tocEntries.length - 10} more`);
  }

  // --- Tables ---
  const tableCount = $('table').count();
  if (tableCount > 0) {
    console.log(`\n=== Tables (first 3 of ${tableCount}) ===`);
    const tables = $('table').toArray().slice(0, 3);
    for (const t of tables) {
      const text = t.text.slice(0, 120).replace(/\n/g, ' ');
      console.log(`  [p.${t.pageIndex + 1}] ${text}...`);
    }
  }

  // --- Queries ---
  console.log('\n=== Queries ===');

  const revenue = $('ocr').contains('revenue');
  console.log(`  $('ocr').contains('revenue'):  ${revenue.count()} hits`);
  if (revenue.count() > 0) {
    console.log(`    first: "${revenue.first()?.text.slice(0, 80)}"`);
  }

  console.log(`  $('table').onPage(1):           ${$('table').onPage(1).count()} tables`);
  console.log(`  $('ocr').onPage(2):             ${$('ocr').onPage(2).count()} blocks`);
  console.log(`  $('[confidence>0.9]'):           ${$('[confidence>0.9]').count()} entities`);

  // --- Tables per page ---
  if (tableCount > 0) {
    console.log(`\n=== Tables Per Page ===`);
    const allTables = $('table').toArray();
    const perPage = new Map<number, number>();
    for (const t of allTables) {
      const p = t.pageIndex + 1;
      perPage.set(p, (perPage.get(p) || 0) + 1);
    }
    const sorted = [...perPage.entries()].sort((a, b) => b[1] - a[1]);
    for (const [page, count] of sorted.slice(0, 15)) {
      const bar = '#'.repeat(count);
      console.log(`  p.${String(page).padStart(3)}  ${bar} (${count})`);
    }
    if (sorted.length > 15) console.log(`  ... ${sorted.length - 15} more pages with tables`);
  }

  // --- Artifacts ---
  console.log(`\n=== Artifacts ===`);
  console.log(`  ocr:pages:     ${(doc.artifacts.get('ocr:pages') as any[])?.length ?? 0} pages`);
  console.log(`  toc:entries:   ${tocEntries?.length ?? 0} entries`);
  console.log(`  pages:images:  ${doc.artifacts.has('pages:images') ? 'yes' : 'not requested'}`);

  // --- Serialize to HTML (uses buildTagTree for bbox nesting) ---
  const name = basename(pdfPath, '.pdf');
  // Collect all tags from the query engine
  const allEntities = doc.$('*').toArray();
  const tags: Array<{ id: string; type: string; page: number; bbox: { x: number; y: number; width: number; height: number }; text?: string; attrs?: Record<string, unknown> }> = allEntities.map(e => ({
    id: e.id,
    type: e.type,
    page: e.pageIndex + 1,
    bbox: { x: e.bbox.xmin, y: e.bbox.ymin, width: e.bbox.xmax - e.bbox.xmin, height: e.bbox.ymax - e.bbox.ymin },
    text: e.text,
    attrs: { confidence: e.meta.confidence },
  }));
  const html = serializeHTML(tags, doc.artifacts, { title: name });
  const outPath = `/tmp/${name}-tree.html`;
  writeFileSync(outPath, html);
  console.log(`\n=== HTML Tree ===`);
  console.log(`  Written to: ${outPath}`);
  console.log(`  Open: open ${outPath}`);

  console.log('\nDone\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
