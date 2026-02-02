/**
 * The README example — three plugins stacked, one query interface.
 *
 *   pymupdf        — local, runs at load, produces tags immediately
 *   llamaParse     — cloud, defer:true, extracts only when .markdown() is called
 *   vlmOpenRouter  — VLM, fires only when .vlm() is called
 *
 * Usage:
 *   LLAMAINDEX_API_KEY=llx-... OPENROUTER_API_KEY=sk-or-... \
 *     npx tsx examples/stacked.ts ./report.pdf
 *
 * Or skip VLM (no OPENROUTER_API_KEY):
 *   LLAMAINDEX_API_KEY=llx-... npx tsx examples/stacked.ts ./report.pdf
 */

import pdfquery from '../src/session';
import { pymupdf } from '../pdfquery-plugins/src/pymupdf';
import { llamaParse } from '../pdfquery-plugins/src/llamaparse';
import { vlmOpenRouter } from '../pdfquery-plugins/src/vlm-openrouter';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npx tsx examples/stacked.ts <path-to-pdf>');
  process.exit(1);
}

const pdf = { type: 'path' as const, path: pdfPath };
const hasVlmKey = !!process.env.OPENROUTER_API_KEY;

async function main() {
  // ── Build plugin stack ─────────────────────────────────────────────────────

  const plugins: any[] = [
    pymupdf({ pdf, extractImages: hasVlmKey }),
    llamaParse({ pdf, defer: true }),
  ];
  if (hasVlmKey) plugins.push(vlmOpenRouter());

  const session = pdfquery();
  session.on('llamaparse:uploaded', (_, d: any) => console.log('  llamaparse: uploaded, job:', d.jobId));
  session.on('llamaparse:polling', () => process.stdout.write('.'));
  session.on('llamaparse:done', () => console.log(' done'));

  for (const p of plugins) session.use(p);

  console.log('\n=== Loading (pymupdf runs, llamaParse deferred) ===\n');
  const doc = await session.load();
  const $ = doc.$;

  // ── 1. Instant queries (pymupdf already ran) ──────────────────────────────

  console.log('--- pymupdf results (instant) ---');
  console.log(`  $('*').count():                ${$('*').count()} entities`);
  console.log(`  $('table').count():            ${$('table').count()} tables`);
  console.log(`  $('ocr').count():              ${$('ocr').count()} OCR blocks`);
  console.log(`  $('heading').count():          ${$('heading').count()} headings`);
  console.log(`  $('*').countByPage():          ${JSON.stringify([...$('*').countByPage()])}`);

  const rev = $('ocr').contains('revenue');
  if (rev.count() > 0) {
    console.log(`  $('ocr').contains('revenue'):  ${rev.count()} hits`);
    console.log(`    first: "${rev.first()?.text.slice(0, 80)}"`);
  }

  // ── 2. Deferred LlamaParse (.markdown()) ───────────────────────────────────

  // Pick a page with content (skip cover pages)
  const targetPage = $('table').count() > 0
    ? ($('table').first()!.pageIndex + 1)
    : 1;

  console.log(`\n--- llamaParse deferred extraction (page ${targetPage}) ---`);
  console.log('  Requesting markdown (triggers upload + parse)...');
  const countBefore = $('*').count();
  const t0 = Date.now();
  const md = await $(':page(' + targetPage + ')').markdown();
  const elapsed = Date.now() - t0;
  console.log(`  Got ${md.length} chars in ${elapsed}ms`);
  console.log(`  Preview: ${md.slice(0, 200).replace(/\n/g, ' ')}...`);

  // Tags injected by llamaParse are now queryable
  console.log(`\n  Entities before: ${countBefore}, after: ${$('*').count()}`);

  // Second call — should be cache hit
  console.log('\n  Requesting same page again (should be cache hit)...');
  const t1 = Date.now();
  const md2 = await $(':page(' + targetPage + ')').markdown();
  const elapsed2 = Date.now() - t1;
  console.log(`  ${elapsed2}ms (vs ${elapsed}ms first time) — ${md2.length === md.length ? 'same content' : 'DIFFERENT'}`);

  // ── 3. VLM query (.vlm()) ──────────────────────────────────────────────────

  if (hasVlmKey) {
    console.log('\n--- VLM query ---');
    const tables = $('table').onPage(1);
    if (tables.count() > 0) {
      console.log(`  Asking VLM about first table on page 1...`);
      const answer = await tables.eq(0).css({ margin: 20 }).vlm('what are the column headers in this table?');
      console.log(`  VLM says: ${answer.slice(0, 200)}`);
    } else {
      console.log(`  Asking VLM about page 1...`);
      const answer = await $('page:first').vlm('summarize this page in 2 sentences');
      console.log(`  VLM says: ${answer.slice(0, 200)}`);
    }
  } else {
    console.log('\n--- VLM skipped (no OPENROUTER_API_KEY) ---');
  }

  console.log('\nDone.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
