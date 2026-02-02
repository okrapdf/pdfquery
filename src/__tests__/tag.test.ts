import { describe, it, expect } from 'vitest';
import { buildTagTree, computeCoverage, findOrphans } from '../tag';
import type { Tag } from '../tag';

// Helper to make a tag
function tag(id: string, type: string, page: number, x: number, y: number, w: number, h: number): Tag {
  return { id, type, page, bbox: { x, y, width: w, height: h } };
}

describe('buildTagTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildTagTree([])).toEqual([]);
  });

  it('single tag becomes a root', () => {
    const tags = [tag('a', 'table', 1, 0, 0, 1, 1)];
    const roots = buildTagTree(tags);
    expect(roots).toHaveLength(1);
    expect(roots[0].tag.id).toBe('a');
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children).toHaveLength(0);
  });

  it('nested bbox creates parent/child', () => {
    const tags = [
      tag('parent', 'table', 1, 0, 0, 1, 1),
      tag('child', 'text', 1, 0.1, 0.1, 0.3, 0.3),
    ];
    const roots = buildTagTree(tags);
    // Parent (larger area) is root, child is nested
    const parent = roots.find(r => r.tag.id === 'parent');
    expect(parent).toBeDefined();
    expect(parent!.children).toHaveLength(1);
    expect(parent!.children[0].tag.id).toBe('child');
    expect(parent!.children[0].depth).toBe(1);
  });

  it('non-overlapping tags are both roots', () => {
    const tags = [
      tag('left', 'table', 1, 0, 0, 0.4, 0.4),
      tag('right', 'figure', 1, 0.5, 0, 0.4, 0.4),
    ];
    const roots = buildTagTree(tags);
    expect(roots).toHaveLength(2);
  });

  it('multi-level nesting sets correct depth', () => {
    const tags = [
      tag('outer', 'table', 1, 0, 0, 1, 1),
      tag('middle', 'text', 1, 0.1, 0.1, 0.5, 0.5),
      tag('inner', 'number', 1, 0.15, 0.15, 0.2, 0.2),
    ];
    const roots = buildTagTree(tags);
    const outer = roots.find(r => r.tag.id === 'outer');
    expect(outer).toBeDefined();
    expect(outer!.depth).toBe(0);
    expect(outer!.children).toHaveLength(1);
    const middle = outer!.children[0];
    expect(middle.tag.id).toBe('middle');
    expect(middle.depth).toBe(1);
    expect(middle.children).toHaveLength(1);
    expect(middle.children[0].tag.id).toBe('inner');
    expect(middle.children[0].depth).toBe(2);
  });

  it('groups tags by page', () => {
    const tags = [
      tag('p1', 'table', 1, 0, 0, 1, 1),
      tag('p2', 'table', 2, 0, 0, 1, 1),
    ];
    const roots = buildTagTree(tags);
    // Two roots, one per page
    expect(roots).toHaveLength(2);
    expect(roots.map(r => r.tag.page).sort()).toEqual([1, 2]);
  });
});

describe('computeCoverage', () => {
  it('returns 0 for empty input', () => {
    expect(computeCoverage([])).toBe(0);
  });

  it('full page tag returns ~1.0', () => {
    const tags = [tag('a', 'table', 1, 0, 0, 1, 1)];
    const cov = computeCoverage(tags);
    expect(cov).toBeGreaterThan(0.95);
    expect(cov).toBeLessThanOrEqual(1);
  });

  it('half-page tag returns ~0.5', () => {
    const tags = [tag('a', 'table', 1, 0, 0, 1, 0.5)];
    const cov = computeCoverage(tags);
    expect(cov).toBeGreaterThan(0.4);
    expect(cov).toBeLessThan(0.6);
  });

  it('quarter-page tag returns ~0.25', () => {
    const tags = [tag('a', 'table', 1, 0, 0, 0.5, 0.5)];
    const cov = computeCoverage(tags);
    expect(cov).toBeGreaterThan(0.2);
    expect(cov).toBeLessThan(0.35);
  });
});

describe('findOrphans', () => {
  it('returns empty when all OCR blocks are inside semantic tags', () => {
    const ocr = [tag('o1', 'ocr', 1, 0.1, 0.1, 0.2, 0.2)];
    const semantic = [tag('s1', 'table', 1, 0, 0, 1, 1)];
    expect(findOrphans(ocr, semantic)).toHaveLength(0);
  });

  it('returns orphans not contained in any semantic tag', () => {
    const ocr = [
      tag('o1', 'ocr', 1, 0.1, 0.1, 0.2, 0.2),   // inside table
      tag('o2', 'ocr', 1, 0.8, 0.8, 0.15, 0.15),   // outside table
    ];
    const semantic = [tag('s1', 'table', 1, 0, 0, 0.5, 0.5)];
    const orphans = findOrphans(ocr, semantic);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe('o2');
  });

  it('respects page boundaries', () => {
    const ocr = [tag('o1', 'ocr', 2, 0.1, 0.1, 0.2, 0.2)];
    const semantic = [tag('s1', 'table', 1, 0, 0, 1, 1)]; // different page
    expect(findOrphans(ocr, semantic)).toHaveLength(1);
  });

  it('returns all when no semantic tags exist', () => {
    const ocr = [
      tag('o1', 'ocr', 1, 0.1, 0.1, 0.2, 0.2),
      tag('o2', 'ocr', 1, 0.5, 0.5, 0.2, 0.2),
    ];
    expect(findOrphans(ocr, [])).toHaveLength(2);
  });
});
