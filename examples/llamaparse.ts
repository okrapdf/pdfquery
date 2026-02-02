/**
 * pdfquery + LlamaParse — cloud OCR with structured extraction.
 *
 * Requires: LLAMAINDEX_API_KEY env var
 * Run:      LLAMAINDEX_API_KEY=llx-... npx tsx examples/llamaparse.ts ./report.pdf
 *
 * After `npm install pdfquery @okrapdf/pdfquery-plugins`, imports become:
 *   import pdfquery from 'pdfquery'
 *   import { llamaParse } from '@okrapdf/pdfquery-plugins'
 */
import pdfquery from '../src/session';
import { llamaParse } from '../pdfquery-plugins/src/llamaparse';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npx tsx examples/llamaparse.ts <path-to-pdf>');
  process.exit(1);
}

const session = pdfquery();

// Listen to progress events
session.on('llamaparse:uploaded', (_, d: any) => console.log('uploaded, job:', d.jobId));
session.on('llamaparse:polling', () => process.stdout.write('.'));
session.on('llamaparse:done', () => console.log('\nparsing complete'));

session.use(llamaParse({
  pdf: { type: 'path', path: pdfPath },
  // targetPages: '1-5',     // optional: limit to specific pages
  // includeWordOcr: true,   // optional: word-level OCR from images
}) as any);

const doc = await session.load();
const $ = doc.$;

// ── Overview ─────────────────────────────────────────────
console.log('\n' + $('*').count(), 'entities extracted');
console.log('by type:', $('*').countByType());
console.log('by page:', $('*').countByPage());

// ── Headings ─────────────────────────────────────────────
console.log('\nHeadings:');
for (const h of $('heading').values()) {
  console.log(`  ${h}`);
}

// ── Tables ───────────────────────────────────────────────
const tables = $('table');
console.log('\n' + tables.count(), 'tables:');

// Access rich attrs via selectors and .attr()
for (let i = 0; i < tables.count(); i++) {
  const t = tables.eq(i);
  const md = t.attr('markdown') as string | undefined;
  const rows = t.attr('rows') as unknown[][] | undefined;
  const perfect = t.attr('isPerfectTable') ? ' (perfect)' : '';
  console.log(`  table ${i + 1}: ${rows?.length ?? '?'} rows${perfect}`);
  if (md) console.log(`    ${md.split('\n')[0].slice(0, 80)}...`);
}

// Filter tables by attribute
const perfectTables = $('table[isPerfectTable=true]');
console.log('\n' + perfectTables.count(), 'perfect tables');

// ── Text search ──────────────────────────────────────────
const revenue = $('*').contains('Revenue');
if (revenue.count() > 0) {
  console.log('\n' + revenue.count(), 'entities mention "Revenue":');
  console.log(revenue.texts().map(t => t.slice(0, 100)));
}
