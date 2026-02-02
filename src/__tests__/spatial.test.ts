import { describe, it, expect } from 'vitest';
import pdfquery from '../session';
import { createQueryEngine } from '../query';
import type { Tag } from '../tag';

function createSpatialTestTags(): Tag[] {
  // Create entities at known positions on page 1:
  //
  //   [header]     (top: 0.05-0.1, full width)
  //      |
  //   [label]      (0.1, 0.2) --- [value]  (0.5, 0.2)
  //      |
  //   [table]      (middle: 0.3-0.6, full width)
  //      |
  //   [footnote]   (bottom: 0.9-0.95, full width)

  return [
    { id: 'header-1', type: 'header', page: 1, bbox: { x: 0.1, y: 0.05, width: 0.8, height: 0.05 }, text: 'Financial Report', attrs: { confidence: 0.99 } },
    { id: 'label-1', type: 'label', page: 1, bbox: { x: 0.1, y: 0.2, width: 0.2, height: 0.03 }, text: 'Total Revenue', attrs: { confidence: 0.95 } },
    { id: 'value-1', type: 'currency', page: 1, bbox: { x: 0.5, y: 0.2, width: 0.15, height: 0.03 }, text: '$12,500M', attrs: { confidence: 0.98 } },
    { id: 'table-1', type: 'table', page: 1, bbox: { x: 0.1, y: 0.3, width: 0.8, height: 0.3 }, text: 'Revenue Table', attrs: { confidence: 0.97 } },
    { id: 'footnote-1', type: 'footnote', page: 1, bbox: { x: 0.1, y: 0.9, width: 0.8, height: 0.05 }, text: '(1) Non-GAAP', attrs: { confidence: 0.9 } },
    // Page 2 entities
    { id: 'header-2', type: 'header', page: 2, bbox: { x: 0.1, y: 0.05, width: 0.8, height: 0.05 }, text: 'Balance Sheet', attrs: { confidence: 0.99 } },
    { id: 'table-2', type: 'table', page: 2, bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }, text: 'Assets Table', attrs: { confidence: 0.96 } },
  ];
}

describe('Spatial queries', () => {
  const session = pdfquery.ready({ tags: createSpatialTestTags() });
  const $$ = createQueryEngine(session.document!);

  describe('.near()', () => {
    it('finds entities near a source within distance', () => {
      // label-1 at (0.1, 0.2), value-1 at (0.5, 0.2) - horizontal distance ~0.4
      const nearLabel = $$('#label-1').near(0.5);
      expect(nearLabel.count()).toBeGreaterThan(0);
      expect(nearLabel.ids()).toContain('value-1');
    });

    it('excludes distant entities', () => {
      // footnote-1 at y=0.9 is far from header-1 at y=0.05
      const nearHeader = $$('#header-1').near(0.2);
      expect(nearHeader.ids()).not.toContain('footnote-1');
    });

    it('respects samePageOnly option', () => {
      const nearTable1 = $$('#table-1').near(1.0, { samePageOnly: true });
      expect(nearTable1.ids()).not.toContain('table-2');
      expect(nearTable1.ids()).not.toContain('header-2');
    });
  });

  describe('.above()', () => {
    it('finds entities above source', () => {
      // header-1 (y=0.05) is above label-1 (y=0.2)
      const aboveLabel = $$('#label-1').above();
      expect(aboveLabel.ids()).toContain('header-1');
    });

    it('excludes entities below or at same level', () => {
      const aboveTable = $$('#table-1').above();
      expect(aboveTable.ids()).not.toContain('footnote-1');
    });

    it('respects maxDistance', () => {
      // footnote at 0.9, table ends at 0.6 - distance is 0.3
      const aboveFootnote = $$('#footnote-1').above({ maxDistance: 0.1 });
      expect(aboveFootnote.ids()).not.toContain('table-1');
    });
  });

  describe('.below()', () => {
    it('finds entities below source', () => {
      // footnote-1 (y=0.9) is below table-1 (ends at y=0.6), distance=0.3
      const belowTable = $$('#table-1').below({ maxDistance: 0.35 });
      expect(belowTable.ids()).toContain('footnote-1');
    });

    it('excludes entities above', () => {
      const belowHeader = $$('#header-1').below();
      expect(belowHeader.ids()).not.toContain('footnote-1'); // wait, footnote is below header
    });

    it('respects maxDistance', () => {
      // header at 0.05-0.1, footnote at 0.9 - far apart
      const belowHeader = $$('#header-1').below({ maxDistance: 0.2 });
      expect(belowHeader.ids()).not.toContain('footnote-1');
      expect(belowHeader.ids()).toContain('label-1'); // label at 0.2 is within 0.2 of header end (0.1)
    });
  });

  describe('.leftOf()', () => {
    it('finds entities to the left of source', () => {
      // label-1 ends at x=0.3, value-1 starts at x=0.5, distance=0.2
      const leftOfValue = $$('#value-1').leftOf({ maxDistance: 0.25 });
      expect(leftOfValue.ids()).toContain('label-1');
    });

    it('excludes entities to the right', () => {
      const leftOfLabel = $$('#label-1').leftOf();
      expect(leftOfLabel.ids()).not.toContain('value-1');
    });
  });

  describe('.rightOf()', () => {
    it('finds entities to the right of source', () => {
      // label-1 ends at x=0.3, value-1 starts at x=0.5, distance=0.2
      const rightOfLabel = $$('#label-1').rightOf({ maxDistance: 0.25 });
      expect(rightOfLabel.ids()).toContain('value-1');
    });

    it('excludes entities to the left', () => {
      const rightOfValue = $$('#value-1').rightOf();
      expect(rightOfValue.ids()).not.toContain('label-1');
    });
  });

  describe('.within()', () => {
    it('finds entities within bbox (intersects mode)', () => {
      // Top half of page
      const topHalf = $$('*').onPage(1).within({ xmin: 0, ymin: 0, xmax: 1, ymax: 0.5 });
      expect(topHalf.ids()).toContain('header-1');
      expect(topHalf.ids()).toContain('label-1');
      expect(topHalf.ids()).toContain('table-1'); // table intersects top half
      expect(topHalf.ids()).not.toContain('footnote-1');
    });

    it('finds entities within bbox (contains mode)', () => {
      // Only entities fully contained in top quarter
      const topQuarter = $$('*').onPage(1).within(
        { xmin: 0, ymin: 0, xmax: 1, ymax: 0.25 },
        { mode: 'contains' }
      );
      expect(topQuarter.ids()).toContain('header-1');
      expect(topQuarter.ids()).toContain('label-1');
      expect(topQuarter.ids()).not.toContain('table-1'); // table extends beyond 0.25
    });

    it('supports x/y/width/height format', () => {
      const region = $$('*').onPage(1).within({ x: 0, y: 0, width: 1, height: 0.25 });
      expect(region.ids()).toContain('header-1');
    });
  });
});
