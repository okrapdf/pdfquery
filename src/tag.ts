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
// Bbox Helpers
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
