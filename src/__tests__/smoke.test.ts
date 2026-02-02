/**
 * Smoke tests: spatial queries, selectors, and chained workflows
 * against a realistic 2-page financial report layout.
 *
 *   Page 1:
 *     [header]              "Financial Report"          (top, full width)
 *     [label] ── [currency] "Total Revenue" → "$12,500M" (row)
 *     [label] ── [currency] "Net Income"    → "$3,200M"  (row)
 *     [table]               revenue table               (mid)
 *     [figure]              chart                       (lower-mid)
 *     [footnote]            "(1) Non-GAAP"              (bottom)
 *
 *   Page 2:
 *     [header]              "Balance Sheet"
 *     [table]               assets table
 *     [ocr]                 "revenue increased by 15%"
 */

import { describe, it, expect } from 'vitest';
import pdfquery from '../session';
import type { Tag } from '../tag';

const tags: Tag[] = [
  // Page 1
  { id: 'h1',  type: 'header',   page: 1, bbox: { x: 0.05, y: 0.02, width: 0.9, height: 0.05 }, text: 'Financial Report',     attrs: { confidence: 0.99 } },
  { id: 'l1',  type: 'label',    page: 1, bbox: { x: 0.05, y: 0.15, width: 0.2, height: 0.03 }, text: 'Total Revenue',        attrs: { confidence: 0.97 } },
  { id: 'c1',  type: 'currency', page: 1, bbox: { x: 0.50, y: 0.15, width: 0.15, height: 0.03 }, text: '$12,500M',            attrs: { confidence: 0.98 } },
  { id: 'l2',  type: 'label',    page: 1, bbox: { x: 0.05, y: 0.20, width: 0.2, height: 0.03 }, text: 'Net Income',           attrs: { confidence: 0.96 } },
  { id: 'c2',  type: 'currency', page: 1, bbox: { x: 0.50, y: 0.20, width: 0.15, height: 0.03 }, text: '$3,200M',             attrs: { confidence: 0.95 } },
  { id: 't1',  type: 'table',    page: 1, bbox: { x: 0.05, y: 0.30, width: 0.9, height: 0.25 }, text: '| Q | Rev |\n|---|---|\n| Q1 | 3000 |', attrs: { confidence: 0.97, markdown: '| Q | Rev |\n|---|---|\n| Q1 | 3000 |' } },
  { id: 'f1',  type: 'figure',   page: 1, bbox: { x: 0.10, y: 0.60, width: 0.8, height: 0.15 }, text: 'Revenue chart',        attrs: { confidence: 0.92 } },
  { id: 'fn1', type: 'footnote', page: 1, bbox: { x: 0.05, y: 0.90, width: 0.9, height: 0.04 }, text: '(1) Non-GAAP measure', attrs: { confidence: 0.88 } },

  // Page 2
  { id: 'h2',  type: 'header',   page: 2, bbox: { x: 0.05, y: 0.02, width: 0.9, height: 0.05 }, text: 'Balance Sheet',        attrs: { confidence: 0.99 } },
  { id: 't2',  type: 'table',    page: 2, bbox: { x: 0.05, y: 0.15, width: 0.9, height: 0.35 }, text: '| Asset | Value |\n|---|---|\n| Cash | 5000 |', attrs: { confidence: 0.96 } },
  { id: 'o1',  type: 'ocr',      page: 2, bbox: { x: 0.05, y: 0.55, width: 0.6, height: 0.03 }, text: 'revenue increased by 15%', attrs: { confidence: 0.91 } },
];

const doc = pdfquery.ready({ tags });
const $ = doc.$;

// ============================================================================
// Spatial queries
// ============================================================================

describe('spatial: leftOf / rightOf', () => {
  it('finds labels to the left of currency values', () => {
    const left = $('currency').leftOf({ maxDistance: 0.3, requireOverlap: true });
    expect(left.count()).toBeGreaterThan(0);
    expect(left.ids()).toContain('l1');
    expect(left.ids()).toContain('l2');
  });

  it('finds currency to the right of a label', () => {
    const revLabel = $('label').contains('Total Revenue').eq(0);
    const right = revLabel.rightOf({ maxDistance: 0.5, requireOverlap: true });
    expect(right.texts()).toContain('$12,500M');
  });
});

describe('spatial: above / below', () => {
  it('finds entities below figures', () => {
    const below = $('figure').below({ maxDistance: 0.2 });
    expect(below.count()).toBeGreaterThan(0);
  });

  it('finds header above label', () => {
    const above = $('label').eq(0).above({ maxDistance: 0.2 });
    expect(above.ids()).toContain('h1');
  });
});

describe('spatial: near', () => {
  it('finds entities near a table', () => {
    const near = $('table').eq(0).near(0.15);
    expect(near.count()).toBeGreaterThan(0);
  });
});

describe('spatial: within', () => {
  it('finds entities in top-right quadrant', () => {
    const topRight = $('*').onPage(1).within({ xmin: 0.5, ymin: 0, xmax: 1, ymax: 0.5 });
    expect(topRight.count()).toBeGreaterThan(0);
    expect(topRight.ids()).toContain('c1');
    expect(topRight.ids()).toContain('c2');
  });
});

// ============================================================================
// Selector + chain combos
// ============================================================================

describe('selector chains', () => {
  it('text search → spatial → selection', () => {
    const label = $('ocr').contains('revenue').eq(0);
    expect(label.count()).toBe(1);
    expect(label.text()).toBe('revenue increased by 15%');

    // rightOf shouldn't throw even with 0 results
    const right = label.rightOf({ maxDistance: 0.15, requireOverlap: true });
    expect(right.count()).toBeGreaterThanOrEqual(0);
  });

  it('basic selectors', () => {
    expect($('table').count()).toBe(2);
    expect($('currency').count()).toBe(2);
    expect($('[confidence>0.95]').count()).toBeGreaterThan(0);
    expect($('*').countByType().size).toBeGreaterThan(0);
    expect($('*').countByPage().size).toBe(2);
  });
});
