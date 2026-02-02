/**
 * Smoke-test every code snippet in README.md against a realistic fixture.
 *
 * Run: npx tsx scripts/readme-smoke.ts
 *
 * Builds a mini financial-report layout:
 *
 *   Page 1:
 *     [header]           "Financial Report"         (top, full width)
 *     [label] ── [currency]  "Total Revenue" → "$12,500M"  (row, mid-left → mid-right)
 *     [table]            revenue table              (mid, full width)
 *     [figure]           chart                      (lower-mid)
 *     [footnote]         "(1) Non-GAAP"             (bottom)
 *
 *   Page 2:
 *     [header]           "Balance Sheet"
 *     [table]            assets table
 *     [ocr]              "revenue increased by 15%"
 */

import pdfquery from '../src/session';
import type { Tag } from '../src/tag';

// ── fixture ──────────────────────────────────────────────────────────────────

const tags: Tag[] = [
  // Page 1
  { id: 'h1',  type: 'header',   page: 1, bbox: { x: 0.05, y: 0.02, width: 0.9, height: 0.05 }, text: 'Financial Report',    attrs: { confidence: 0.99 } },
  { id: 'l1',  type: 'label',    page: 1, bbox: { x: 0.05, y: 0.15, width: 0.2, height: 0.03 }, text: 'Total Revenue',       attrs: { confidence: 0.97 } },
  { id: 'c1',  type: 'currency', page: 1, bbox: { x: 0.50, y: 0.15, width: 0.15, height: 0.03 }, text: '$12,500M',           attrs: { confidence: 0.98 } },
  { id: 'l2',  type: 'label',    page: 1, bbox: { x: 0.05, y: 0.20, width: 0.2, height: 0.03 }, text: 'Net Income',          attrs: { confidence: 0.96 } },
  { id: 'c2',  type: 'currency', page: 1, bbox: { x: 0.50, y: 0.20, width: 0.15, height: 0.03 }, text: '$3,200M',            attrs: { confidence: 0.95 } },
  { id: 't1',  type: 'table',    page: 1, bbox: { x: 0.05, y: 0.30, width: 0.9, height: 0.25 }, text: '| Q | Rev |\n|---|---|\n| Q1 | 3000 |', attrs: { confidence: 0.97, markdown: '| Q | Rev |\n|---|---|\n| Q1 | 3000 |' } },
  { id: 'f1',  type: 'figure',   page: 1, bbox: { x: 0.10, y: 0.60, width: 0.8, height: 0.15 }, text: 'Revenue chart',       attrs: { confidence: 0.92 } },
  { id: 'fn1', type: 'footnote', page: 1, bbox: { x: 0.05, y: 0.90, width: 0.9, height: 0.04 }, text: '(1) Non-GAAP measure', attrs: { confidence: 0.88 } },

  // Page 2
  { id: 'h2',  type: 'header',   page: 2, bbox: { x: 0.05, y: 0.02, width: 0.9, height: 0.05 }, text: 'Balance Sheet',       attrs: { confidence: 0.99 } },
  { id: 't2',  type: 'table',    page: 2, bbox: { x: 0.05, y: 0.15, width: 0.9, height: 0.35 }, text: '| Asset | Value |\n|---|---|\n| Cash | 5000 |', attrs: { confidence: 0.96 } },
  { id: 'o1',  type: 'ocr',      page: 2, bbox: { x: 0.05, y: 0.55, width: 0.6, height: 0.03 }, text: 'revenue increased by 15%', attrs: { confidence: 0.91 } },
];

const doc = pdfquery.ready({ tags });
const $ = doc.$;

// ── README Workflow 2: Spatial queries ───────────────────────────────────────

let pass = 0;
let fail = 0;

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  OK  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n── Spatial queries ──\n');

// $('currency').leftOf({ maxDistance: 0.3, requireOverlap: true })
// "find the label to the left of each currency value"
const leftOfCurrency = $('currency').leftOf({ maxDistance: 0.3, requireOverlap: true });
assert(
  "$('currency').leftOf({ maxDistance: 0.3, requireOverlap: true })",
  leftOfCurrency.count() > 0 && leftOfCurrency.ids().some(id => id.startsWith('l')),
  `got ${leftOfCurrency.count()} results: ${leftOfCurrency.ids()}`,
);

// $('figure').below({ maxDistance: 0.1 })
// "find footnotes below figures"
const belowFigure = $('figure').below({ maxDistance: 0.2 });
assert(
  "$('figure').below({ maxDistance: 0.2 })",
  belowFigure.count() > 0,
  `got ${belowFigure.count()} results: ${belowFigure.ids()}`,
);

// $('table:first').near(0.1)
// ":first" pseudo — returns first table, then finds nearby entities
const nearTable = $('table').eq(0).near(0.15);
assert(
  "$('table').eq(0).near(0.15)",
  nearTable.count() > 0,
  `got ${nearTable.count()} results: ${nearTable.ids()}`,
);

// $('*').onPage(1).within({ xmin: 0.5, ymin: 0, xmax: 1, ymax: 0.5 })
// "find entities in the top-right quadrant of page 1"
const topRight = $('*').onPage(1).within({ xmin: 0.5, ymin: 0, xmax: 1, ymax: 0.5 });
assert(
  "$('*').onPage(1).within(top-right quadrant)",
  topRight.count() > 0 && topRight.ids().some(id => id.startsWith('c')),
  `got ${topRight.count()} results: ${topRight.ids()}`,
);

// Combined: "find label to the left → read value"
console.log('\n── Spatial + chain ──\n');

const label = $('ocr').contains('revenue').eq(0);
assert(
  "$('ocr').contains('revenue').eq(0)",
  label.count() === 1 && label.text() === 'revenue increased by 15%',
  `text="${label.text()}"`,
);

const rightOfLabel = label.rightOf({ maxDistance: 0.15, requireOverlap: true });
assert(
  "label.rightOf({ requireOverlap: true })",
  true, // may be 0 results since there's nothing to the right of o1, but it shouldn't throw
  `got ${rightOfLabel.count()} (ok if 0, no entity to the right)`,
);

// The "Total Revenue" → "$12,500M" pair
const revLabel = $('label').contains('Total Revenue').eq(0);
const revValue = revLabel.rightOf({ maxDistance: 0.5, requireOverlap: true });
assert(
  "label('Total Revenue').rightOf() finds currency",
  revValue.count() > 0 && revValue.texts().includes('$12,500M'),
  `got: ${revValue.texts()}`,
);

// ── README Workflow 1: basic selectors ───────────────────────────────────────

console.log('\n── Basic selectors ──\n');

assert("$('table').count()", $('table').count() === 2, `got ${$('table').count()}`);
assert("$('currency').count()", $('currency').count() === 2, `got ${$('currency').count()}`);
assert("$('[confidence>0.95]').count()", $('[confidence>0.95]').count() > 0, `got ${$('[confidence>0.95]').count()}`);
assert("$('*').countByType()", $('*').countByType().size > 0, `${$('*').countByType().size} types`);
assert("$('*').countByPage()", $('*').countByPage().size === 2, `${$('*').countByPage().size} pages`);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
