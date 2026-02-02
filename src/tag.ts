/**
 * Tag Model
 *
 * Everything is a tag with a required bbox. The DOM/jQuery analog
 * for PDF document elements. Bbox enables spatial nesting —
 * parent/child from containment, coverage analysis, orphan detection.
 */

// ============================================================================
// Core Types
// ============================================================================

export interface BBox {
  x: number;       // normalized 0-1
  y: number;
  width: number;
  height: number;
}

export interface Tag {
  id: string;
  type: string;                          // like tagName: 'table', 'figure', 'heading'
  page: number;                          // 1-indexed
  bbox: BBox;                            // normalized 0-1, REQUIRED
  text?: string;                         // like textContent
  attrs?: Record<string, unknown>;       // like data-* attributes
}

export interface TagTreeNode {
  tag: Tag;
  children: TagTreeNode[];
  depth: number;
}

// ============================================================================
// Page Data (optional metadata per page)
// ============================================================================

export interface PageData {
  pageNumber: number;                    // 1-indexed
  width?: number;
  height?: number;
  markdown?: string;
}

// ============================================================================
// Bbox Helpers (internal)
// ============================================================================

function bboxArea(b: BBox): number {
  return b.width * b.height;
}

function bboxContains(outer: BBox, inner: BBox): boolean {
  const eps = 1e-6;
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.width <= outer.x + outer.width + eps &&
    inner.y + inner.height <= outer.y + outer.height + eps
  );
}

// ============================================================================
// Bbox Normalization (public — used by plugins)
// ============================================================================
//
// Convention (mirrors okrapdf):
//   VLM output:  0-1000 integer coords  [x1, y1, x2, y2]
//   Storage/Tag:  0-1 normalized         { x, y, width, height }
//
// Plugins call normalizeBbox() to convert any raw bbox format into the
// canonical BBox that Tag.bbox expects. The core owns the contract;
// plugins handle calling it at the boundary.
// ============================================================================

/**
 * Raw bbox input — any format a VLM or OCR engine might return.
 *
 *   [x1, y1, x2, y2]              — 0-1000 Qwen VL grounding coords
 *   { x, y, width, height }       — 0-1 or 0-1000 (auto-detected)
 *   { xmin, ymin, xmax, ymax }    — 0-1 or 0-1000 (auto-detected)
 */
export type RawBBox =
  | number[]
  | { x: number; y: number; width: number; height: number }
  | { xmin: number; ymin: number; xmax: number; ymax: number };

/**
 * Normalize any raw bbox format into the canonical 0-1 BBox.
 *
 * Handles:
 *   - Array [x1,y1,x2,y2]: treated as 0-1000 Qwen grounding coords (÷1000)
 *   - Object {x,y,width,height}: if any value > 1, auto-detected as 0-1000
 *   - Object {xmin,ymin,xmax,ymax}: same auto-detection
 *   - Negative width/height: flips origin (same as okrapdf PdfPageWithOverlay)
 *
 * Returns null if the input is invalid or unparseable.
 */
export function normalizeBbox(raw: unknown): BBox | null {
  if (!raw) return null;

  let x: number, y: number, w: number, h: number;

  if (Array.isArray(raw)) {
    // [x1, y1, x2, y2] — Qwen 0-1000 grounding coords
    if (raw.length < 4 || raw.some(v => typeof v !== 'number')) return null;
    const [x1, y1, x2, y2] = raw as number[];
    x = x1 / 1000;
    y = y1 / 1000;
    w = (x2 - x1) / 1000;
    h = (y2 - y1) / 1000;
  } else if (typeof raw === 'object') {
    const b = raw as Record<string, unknown>;

    if (typeof b.x === 'number' && typeof b.y === 'number'
      && typeof b.width === 'number' && typeof b.height === 'number') {
      x = b.x; y = b.y; w = b.width; h = b.height;
    } else if (typeof b.xmin === 'number' && typeof b.ymin === 'number'
      && typeof b.xmax === 'number' && typeof b.ymax === 'number') {
      x = b.xmin; y = b.ymin; w = b.xmax - b.xmin; h = b.ymax - b.ymin;
    } else {
      return null;
    }

    // Auto-detect 0-1000 scale: if any value > 1, divide by 1000
    if (x > 1 || y > 1 || w > 1 || h > 1) {
      x /= 1000; y /= 1000; w /= 1000; h /= 1000;
    }
  } else {
    return null;
  }

  // Handle negative dimensions (flip origin)
  if (w < 0) { x += w; w = Math.abs(w); }
  if (h < 0) { y += h; h = Math.abs(h); }

  return { x, y, width: w, height: h };
}

/**
 * Clamp a BBox to the valid 0-1 range.
 * Coords outside the page are pulled to the edge.
 */
export function clampBbox(bbox: BBox): BBox {
  const x = Math.max(0, Math.min(1, bbox.x));
  const y = Math.max(0, Math.min(1, bbox.y));
  const width = Math.max(0, Math.min(1 - x, bbox.width));
  const height = Math.max(0, Math.min(1 - y, bbox.height));
  return { x, y, width, height };
}

// ============================================================================
// Tag Tree Builder
// ============================================================================

/**
 * Build parent/child tree from flat tags using bbox containment.
 * For each page, sort by area (largest first). Tag B is child of A
 * if A.bbox fully contains B.bbox. Returns roots (uncontained tags).
 */
export function buildTagTree(tags: Tag[]): TagTreeNode[] {
  if (tags.length === 0) return [];

  // Group by page
  const byPage = new Map<number, Tag[]>();
  for (const tag of tags) {
    const arr = byPage.get(tag.page) || [];
    arr.push(tag);
    byPage.set(tag.page, arr);
  }

  const allRoots: TagTreeNode[] = [];

  for (const pageTags of byPage.values()) {
    // Sort by area descending (largest first = potential parents first)
    const sorted = [...pageTags].sort((a, b) => bboxArea(b.bbox) - bboxArea(a.bbox));

    const nodes: TagTreeNode[] = sorted.map(tag => ({ tag, children: [], depth: 0 }));

    // For each node, find its smallest containing parent
    for (let i = 1; i < nodes.length; i++) {
      let parentFound = false;
      for (let j = i - 1; j >= 0; j--) {
        if (bboxContains(nodes[j].tag.bbox, nodes[i].tag.bbox)) {
          nodes[j].children.push(nodes[i]);
          parentFound = true;
          break;
        }
      }
      if (!parentFound) {
        allRoots.push(nodes[i]);
      }
    }

    // First node per page (largest) is always a root
    if (nodes.length > 0) {
      allRoots.push(nodes[0]);
    }
  }

  // Set depths via BFS
  const setDepths = (node: TagTreeNode, depth: number) => {
    node.depth = depth;
    for (const child of node.children) {
      setDepths(child, depth + 1);
    }
  };
  for (const root of allRoots) {
    setDepths(root, 0);
  }

  return allRoots;
}

// ============================================================================
// Coverage
// ============================================================================

/**
 * Compute what fraction of a page's area is covered by tags.
 * Tags should all be from the same page. Page area = 1.0 (normalized coords).
 * Overlapping regions are not double-counted (uses scanline approximation).
 */
export function computeCoverage(tags: Tag[]): number {
  if (tags.length === 0) return 0;

  // Simple union area via inclusion-exclusion is expensive for many tags.
  // Use a scanline approximation: discretize y-axis, sum x-intervals per row.
  const RESOLUTION = 200;
  const covered = new Float32Array(RESOLUTION);

  for (const tag of tags) {
    const yStart = Math.max(0, Math.floor(tag.bbox.y * RESOLUTION));
    const yEnd = Math.min(RESOLUTION, Math.ceil((tag.bbox.y + tag.bbox.height) * RESOLUTION));

    for (let row = yStart; row < yEnd; row++) {
      covered[row] = Math.min(1, covered[row] + tag.bbox.width);
    }
  }

  let totalCovered = 0;
  for (let i = 0; i < RESOLUTION; i++) {
    totalCovered += covered[i];
  }

  return Math.min(1, totalCovered / RESOLUTION);
}

// ============================================================================
// Orphan Detection
// ============================================================================

/**
 * Find OCR blocks not contained inside any semantic tag.
 * An orphan is an ocrBlock whose bbox is not fully inside any semanticTag's bbox.
 */
export function findOrphans(ocrBlocks: Tag[], semanticTags: Tag[]): Tag[] {
  return ocrBlocks.filter(ocr => {
    const samePageTags = semanticTags.filter(t => t.page === ocr.page);
    return !samePageTags.some(t => bboxContains(t.bbox, ocr.bbox));
  });
}
