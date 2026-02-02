/**
 * pdfquery basic example — no API key, no PDF file needed.
 *
 * Run:  npx tsx examples/basic.ts
 */
import { loadFixture, createQueryEngine } from 'pdfquery';

const session = loadFixture('financial-report');
const $ = createQueryEngine(session.document!);

// ── What got extracted? ──────────────────────────────────
console.log($('*').count(), 'total entities');
console.log('by type:', $('*').countByType());
console.log();

// ── Tables ───────────────────────────────────────────────
console.log($('table').count(), 'tables');
console.log($('table').texts().map(t => t.slice(0, 80)));
console.log();

// ── Text search ──────────────────────────────────────────
const rev = $('ocr').contains('revenue');
console.log(rev.count(), 'entities mention "revenue"');
console.log(rev.texts());
console.log();

// ── Attribute filter ─────────────────────────────────────
console.log($('[confidence>0.95]').count(), 'high-confidence entities');
console.log();

// ── Page grouping ────────────────────────────────────────
console.log('entities per page:', $('*').countByPage());
console.log();

// ── Spatial: near ────────────────────────────────────────
const firstTable = $('table').eq(0);
const nearby = firstTable.near(0.1);
console.log(nearby.count(), 'entities near first table');
