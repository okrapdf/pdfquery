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
console.log('\n' + tables.count(), 'tables');
console.log(tables.texts().map(t => t.slice(0, 80)));

// ── Text search ──────────────────────────────────────────
const revenue = $('*').contains('Revenue');
if (revenue.count() > 0) {
  console.log('\n' + revenue.count(), 'entities mention "Revenue":');
  console.log(revenue.texts().map(t => t.slice(0, 100)));
}
