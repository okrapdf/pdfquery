/**
 * HTML tree serializer plugin for pdfquery.
 *
 * Uses buildTagTree (bbox containment) to nest tags semantically —
 * OCR blocks appear inside tables, headings contain their sections, etc.
 * Outputs a self-contained HTML file you can open in a browser.
 */

import { buildTagTree } from 'pdfquery';
import type { Tag, TagTreeNode } from 'pdfquery';

interface SerializeOptions {
  title?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TYPE_COLORS: Record<string, string> = {
  ocr: '#3b82f6', table: '#8b5cf6', heading: '#f59e0b', figure: '#10b981',
  footnote: '#6b7280', markdown: '#ec4899', text: '#64748b', page: '#0ea5e9',
};

function badge(type: string): string {
  const c = TYPE_COLORS[type] || '#6b7280';
  return `<span class="badge" style="--c:${c}">${esc(type)}</span>`;
}

function bboxStr(b: Tag['bbox']): string {
  return `${b.x.toFixed(3)},${b.y.toFixed(3)} ${b.width.toFixed(3)}×${b.height.toFixed(3)}`;
}

// ============================================================================
// Render a tree node recursively
// ============================================================================

function renderNode(node: TagTreeNode): string {
  const t = node.tag;
  const hasChildren = node.children.length > 0;
  const textPreview = (t.text ?? '').length > 200 ? (t.text ?? '').slice(0, 200) + '...' : (t.text ?? '');
  const isTable = t.type === 'table';
  const conf = t.attrs?.confidence != null ? `${(Number(t.attrs.confidence) * 100).toFixed(0)}%` : '';

  // Render table markdown as actual HTML table
  let content: string;
  if (isTable && t.text) {
    const lines = t.text.split('\n').filter(l => l.trim());
    if (lines.length >= 2) {
      const parseRow = (line: string) =>
        line.split('|').filter(c => c.trim() && !c.match(/^-+$/)).map(c => c.trim());
      const headers = parseRow(lines[0]);
      const rows = lines.slice(2).map(parseRow);
      content = `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } else {
      content = `<pre class="text-block">${esc(textPreview)}</pre>`;
    }
  } else if (textPreview) {
    content = `<pre class="text-block">${esc(textPreview)}</pre>`;
  } else {
    content = '';
  }

  const childrenHTML = hasChildren
    ? `<div class="children">${node.children.map(renderNode).join('')}</div>`
    : '';

  const openAttr = node.depth < 2 && hasChildren ? ' open' : '';

  if (hasChildren) {
    return `<details class="node depth-${node.depth}"${openAttr}>
      <summary>
        ${badge(t.type)}
        <code class="nid">${esc(t.id)}</code>
        <span class="page-tag">p.${t.page}</span>
        <span class="bbox">${bboxStr(t.bbox)}</span>
        ${conf ? `<span class="conf">${conf}</span>` : ''}
        <span class="child-count">${node.children.length} children</span>
      </summary>
      ${content}
      ${childrenHTML}
    </details>`;
  }

  // Leaf node — no <details>
  return `<div class="node leaf depth-${node.depth}">
    <div class="node-header">
      ${badge(t.type)}
      <code class="nid">${esc(t.id)}</code>
      <span class="page-tag">p.${t.page}</span>
      <span class="bbox">${bboxStr(t.bbox)}</span>
      ${conf ? `<span class="conf">${conf}</span>` : ''}
    </div>
    ${content}
  </div>`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Serialize tags to a self-contained HTML document tree.
 *
 * Uses bbox containment to nest tags — tables contain their OCR blocks,
 * headings contain child elements, etc.
 *
 * @example
 * ```ts
 * const html = serializeHTML(tags, { title: 'NVIDIA 10-Q' });
 * writeFileSync('/tmp/tree.html', html);
 * ```
 */
export function serializeHTML(
  tags: Tag[],
  artifacts?: Map<string, unknown>,
  options: SerializeOptions = {},
): string {
  const title = options.title ?? 'pdfquery Document Tree';
  const tree = buildTagTree(tags);

  // Type counts
  const typeCounts = new Map<string, number>();
  for (const t of tags) typeCounts.set(t.type, (typeCounts.get(t.type) || 0) + 1);

  // Group tree roots by page
  const pageMap = new Map<number, TagTreeNode[]>();
  for (const node of tree) {
    const p = node.tag.page;
    if (!pageMap.has(p)) pageMap.set(p, []);
    pageMap.get(p)!.push(node);
  }
  const pages = [...pageMap.entries()].sort((a, b) => a[0] - b[0]);

  // Count nesting stats
  let maxDepth = 0;
  let nested = 0;
  const walk = (n: TagTreeNode) => {
    if (n.depth > maxDepth) maxDepth = n.depth;
    if (n.children.length > 0) nested++;
    n.children.forEach(walk);
  };
  tree.forEach(walk);

  // TOC from artifacts
  const tocEntries = artifacts?.get('toc:entries') as Array<{ level: number; title: string; page: number }> | undefined;

  // Stats bar
  const statsHTML = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `<div class="stat">${badge(type)}<span class="stat-count">${count}</span></div>`)
    .join('');

  // TOC section
  const tocHTML = tocEntries && tocEntries.length > 0
    ? `<details class="section" open>
        <summary>Table of Contents (${tocEntries.length})</summary>
        <ul class="toc-list">
          ${tocEntries.map(e => `<li style="padding-left:${(e.level - 1) * 1.2}em"><span class="toc-page">p.${e.page}</span> ${esc(e.title)}</li>`).join('\n')}
        </ul>
      </details>`
    : '';

  // Pages
  const pagesHTML = pages.map(([pageNum, roots]) => {
    const sorted = roots.sort((a, b) => a.tag.bbox.y - b.tag.bbox.y);
    const totalNodes = roots.reduce((sum, r) => {
      let c = 1;
      const count = (n: TagTreeNode) => { c++; n.children.forEach(count); };
      r.children.forEach(count);
      return sum + c;
    }, 0);
    return `<details class="page"${pageNum <= 3 ? ' open' : ''}>
      <summary>
        <span class="page-num">Page ${pageNum}</span>
        <span class="page-count">${totalNodes} nodes, ${roots.length} roots</span>
      </summary>
      <div class="page-body">
        ${sorted.map(renderNode).join('')}
      </div>
    </details>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root { --bg: #0f172a; --surface: #1e293b; --surface2: #334155; --border: #475569; --text: #e2e8f0; --dim: #94a3b8; --mono: 'SF Mono', 'Fira Code', monospace; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; padding: 2rem; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.2rem; }
  .subtitle { color: var(--dim); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .stats { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; padding: 1rem; background: var(--surface); border-radius: 8px; border: 1px solid var(--border); }
  .stat { display: flex; align-items: center; gap: 0.4rem; }
  .stat-count { font-family: var(--mono); font-size: 1.1rem; font-weight: 600; }
  .badge { display: inline-block; font-family: var(--mono); font-size: 0.7rem; font-weight: 600; padding: 0.12em 0.5em; border-radius: 4px; background: color-mix(in srgb, var(--c) 20%, transparent); color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); text-transform: uppercase; letter-spacing: 0.03em; }
  .section, .page { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 0.75rem; }
  .section > summary, .page > summary { padding: 0.75rem 1rem; cursor: pointer; user-select: none; display: flex; align-items: center; gap: 0.75rem; font-weight: 500; }
  .page > summary:hover { background: var(--surface2); border-radius: 8px; }
  .page-num { font-family: var(--mono); font-weight: 700; min-width: 5rem; }
  .page-count { color: var(--dim); font-size: 0.8rem; }
  .page-body { padding: 0.5rem 1rem 1rem; }

  /* Tree nodes */
  .node { border-left: 2px solid var(--border); margin-left: 0.75rem; padding-left: 0.75rem; margin-bottom: 0.3rem; }
  .node.depth-0 { border-left: 2px solid #8b5cf6; margin-left: 0; }
  .node > summary, .node-header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.3rem 0; cursor: pointer; user-select: none; font-size: 0.85rem; }
  .node-header { cursor: default; }
  .node > summary:hover { color: #fff; }
  .nid { font-family: var(--mono); font-size: 0.65rem; color: var(--dim); }
  .page-tag { font-family: var(--mono); font-size: 0.65rem; color: #0ea5e9; }
  .bbox { font-family: var(--mono); font-size: 0.6rem; color: var(--dim); margin-left: auto; }
  .conf { font-family: var(--mono); font-size: 0.65rem; color: #22c55e; }
  .child-count { font-size: 0.7rem; color: var(--dim); }
  .children { margin-top: 0.2rem; }
  .text-block { font-family: var(--mono); font-size: 0.75rem; color: var(--dim); white-space: pre-wrap; word-break: break-word; max-height: 6rem; overflow-y: auto; line-height: 1.35; margin: 0.2rem 0; padding: 0.4rem; background: var(--bg); border-radius: 4px; }
  .table-wrap { overflow-x: auto; margin: 0.3rem 0; }
  .table-wrap table { font-size: 0.72rem; border-collapse: collapse; width: 100%; }
  .table-wrap th, .table-wrap td { border: 1px solid var(--border); padding: 0.25em 0.4em; text-align: left; font-family: var(--mono); }
  .table-wrap th { background: var(--surface2); font-weight: 600; color: #c4b5fd; }
  .table-wrap td { color: var(--dim); }
  .toc-list { list-style: none; font-size: 0.85rem; padding: 0.5rem 1rem 1rem; }
  .toc-list li { padding: 0.1em 0; color: var(--dim); }
  .toc-page { font-family: var(--mono); font-size: 0.7rem; color: #f59e0b; margin-right: 0.4em; }
  details > summary::marker { color: var(--dim); }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f8fafc; --surface: #fff; --surface2: #f1f5f9; --border: #e2e8f0; --text: #1e293b; --dim: #64748b; }
    .conf { color: #16a34a; }
  }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="subtitle">${tags.length} tags across ${pageMap.size} pages &middot; ${nested} containers &middot; max depth ${maxDepth}</div>
  <div class="stats">${statsHTML}</div>
  ${tocHTML}
  ${pagesHTML}
</body>
</html>`;
}
