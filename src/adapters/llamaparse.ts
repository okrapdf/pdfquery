import type { NormalizedBlock, NormalizedTable, AdapterResult } from './types';

/**
 * LlamaParse adapter
 *
 * SDK: llamaindex or direct API (https://api.cloud.llamaindex.ai)
 * Output: JSON with pages[] containing structured items
 * Bbox format: items[].bBox { x, y, w, h } in points (72 DPI)
 * Normalization: Divide by page width/height
 */

export interface LlamaParseItem {
  type: 'heading' | 'text' | 'table' | 'image' | string;
  value: string;
  md?: string;
  bBox?: { x: number; y: number; w: number; h: number };
  rows?: string[][];
}

export interface LlamaParsePage {
  page: number;
  width?: number;
  height?: number;
  items?: LlamaParseItem[];
  md?: string;
}

export interface LlamaParseResult {
  pages: LlamaParsePage[];
}

function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return '';
  let md = '| ' + rows[0].join(' | ') + ' |\n';
  md += '|' + rows[0].map(() => '---').join('|') + '|\n';
  for (let i = 1; i < rows.length; i++) {
    md += '| ' + rows[i].join(' | ') + ' |\n';
  }
  return md.trim();
}

export function fromLlamaParse(result: LlamaParseResult): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const tables: NormalizedTable[] = [];
  let maxPage = 1;
  let itemIdx = 0;

  for (const page of result.pages) {
    const pageNum = page.page;
    maxPage = Math.max(maxPage, pageNum);
    const pw = page.width ?? 612;
    const ph = page.height ?? 792;

    if (!page.items) continue;

    for (const item of page.items) {
      const id = `lp-${pageNum}-${itemIdx++}`;
      const bbox = item.bBox
        ? { x: item.bBox.x / pw, y: item.bBox.y / ph, width: item.bBox.w / pw, height: item.bBox.h / ph }
        : { x: 0, y: 0, width: 1, height: 1 };

      if (item.type === 'table') {
        tables.push({
          id,
          page: pageNum,
          markdown: item.rows ? rowsToMarkdown(item.rows) : (item.md ?? item.value),
          bbox,
          confidence: 1,
        });
      } else {
        blocks.push({
          id,
          page: pageNum,
          text: item.value,
          bbox,
          confidence: 1,
          type: item.type === 'heading' ? 'paragraph' : item.type === 'image' ? 'figure' : 'paragraph',
        });
      }
    }
  }

  return { blocks, tables, pageCount: maxPage };
}
