/**
 * pdfquery + LlamaParse — lazy on-demand extraction.
 *
 * Instead of extracting the whole PDF upfront, pages are extracted
 * only when you call .markdown() on them. This is useful for large
 * PDFs where you only need a few pages.
 *
 * Requires: LLAMAINDEX_API_KEY env var
 * Run:      LLAMAINDEX_API_KEY=llx-... npx tsx examples/llamaparse-lazy.ts ./report.pdf
 *
 * After `npm install pdfquery @okrapdf/pdfquery-plugins`, imports become:
 *   import pdfquery from 'pdfquery'
 *   import { llamaParse } from '@okrapdf/pdfquery-plugins'
 */
import pdfquery from '../src/session';
import { llamaParse } from '../pdfquery-plugins/src/llamaparse';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: npx tsx examples/llamaparse-lazy.ts <path-to-pdf>');
  process.exit(1);
}

const session = pdfquery();

session.on('llamaparse:extract', (_, d: any) => console.log(`\nextracting pages: ${d.pages}`));
session.on('llamaparse:uploaded', (_, d: any) => console.log('uploaded, job:', d.jobId));
session.on('llamaparse:polling', () => process.stdout.write('.'));
session.on('llamaparse:done', () => console.log(' done'));

// targetPages: 'lazy' — registers extraction handler but skips upfront API call
session.use(llamaParse({
  pdf: { type: 'path', path: pdfPath },
  targetPages: 'lazy',
}) as any);

const doc = await session.load();
const $ = doc.$;

// Nothing extracted yet
console.log($('*').count(), 'entities (should be 0)');

// ── Extract page 1 on demand ─────────────────────────────
// .markdown() sees no cached data, calls extract:pages handler,
// which uploads PDF to LlamaParse with targetPages='1'
console.log('\n--- Requesting page 1 markdown ---');
const page1md = await $(':page(1)').markdown();
console.log('page 1 markdown:', page1md.slice(0, 200), '...');

// Tags from page 1 are now in the session
console.log('\n' + $('*').count(), 'entities after page 1 extraction');
console.log('tables on page 1:', $('table').onPage(1).count());
console.log('headings on page 1:', $('heading').onPage(1).texts());

// ── Extract another page ─────────────────────────────────
console.log('\n--- Requesting page 2 markdown ---');
const page2md = await $(':page(2)').markdown();
console.log('page 2 markdown:', page2md.slice(0, 200), '...');

console.log('\n' + $('*').count(), 'total entities after 2 pages');
