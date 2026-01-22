import type { NormalizedBlock, NormalizedTable, AdapterResult } from './types';

/**
 * Docling adapter (IBM's document conversion library)
 * 
 * SDK: docling
 * Output: DoclingDocument from DocumentConverter().convert()
 * Bbox format: item.prov[].bbox → BoundingBox(l, t, r, b, coord_origin)
 * Normalization: Already normalized if coord_origin='BOTTOMLEFT', else depends on page size
 * 
 * Note: Docling uses BOTTOMLEFT origin by default, so y needs to be flipped
 */

export type CoordOrigin = 'TOPLEFT' | 'BOTTOMLEFT';

export interface DoclingBoundingBox {
  l: number;  // left
  t: number;  // top
  r: number;  // right
  b: number;  // bottom
  coord_origin?: CoordOrigin;
}

export interface DoclingProvenance {
  page_no: number;
  bbox: DoclingBoundingBox;
  charspan?: [number, number];
}

export interface DoclingTextItem {
  self_ref: string;
  label: string;  // 'text', 'section_header', 'caption', 'footnote', 'page_header', 'page_footer', etc.
  text: string;
  prov: DoclingProvenance[];
}

export interface DoclingTableCell {
  text: string;
  row_span?: number;
  col_span?: number;
}

export interface DoclingTableItem {
  self_ref: string;
  label: 'table';
  prov: DoclingProvenance[];
  data: {
    table_cells: DoclingTableCell[][];
  };
}

export interface DoclingFigureItem {
  self_ref: string;
  label: 'figure' | 'picture';
  prov: DoclingProvenance[];
  caption?: string;
}

export interface DoclingPageDimension {
  page_no: number;
  width: number;
  height: number;
}

export interface DoclingDocument {
  texts?: DoclingTextItem[];
  tables?: DoclingTableItem[];
  figures?: DoclingFigureItem[];
  pages?: DoclingPageDimension[];
}

function doclingBboxToNormalized(
  bbox: DoclingBoundingBox,
  pageWidth: number,
  pageHeight: number
) {
  const { l, t, r, b, coord_origin = 'BOTTOMLEFT' } = bbox;
  
  // Normalize to 0-1
  const x = l / pageWidth;
  const width = (r - l) / pageWidth;
  
  let y: number;
  let height: number;
  
  if (coord_origin === 'BOTTOMLEFT') {
    // Bottom-left origin: y increases upward, so flip
    // t is actually the top in visual space (higher value)
    // b is the bottom in visual space (lower value)
    y = 1 - (t / pageHeight);  // flip y
    height = (t - b) / pageHeight;
  } else {
    // Top-left origin: standard
    y = t / pageHeight;
    height = (b - t) / pageHeight;
  }
  
  return { x, y, width, height };
}

function tableCellsToMarkdown(cells: DoclingTableCell[][]): string {
  if (cells.length === 0) return '';
  
  let md = '';
  for (let i = 0; i < cells.length; i++) {
    const row = cells[i];
    md += '| ' + row.map(c => c.text).join(' | ') + ' |\n';
    if (i === 0) {
      md += '|' + row.map(() => '---').join('|') + '|\n';
    }
  }
  
  return md.trim();
}

export function fromDocling(doc: DoclingDocument): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const tables: NormalizedTable[] = [];
  
  // Build page dimensions map (default to 1x1 if not provided)
  const pageDims = new Map<number, { width: number; height: number }>();
  for (const page of doc.pages ?? []) {
    pageDims.set(page.page_no, { width: page.width, height: page.height });
  }
  const getPageDims = (pageNo: number) => pageDims.get(pageNo) ?? { width: 1, height: 1 };
  
  // Process text items
  for (const item of doc.texts ?? []) {
    for (const prov of item.prov) {
      const dims = getPageDims(prov.page_no);
      const bbox = doclingBboxToNormalized(prov.bbox, dims.width, dims.height);
      
      // Map Docling labels to pdfquery types
      let type: NormalizedBlock['type'] = 'paragraph';
      if (item.label === 'footnote') type = 'other';
      else if (item.label === 'page_header' || item.label === 'page_footer') type = 'other';
      
      blocks.push({
        id: item.self_ref,
        page: prov.page_no,
        text: item.text,
        bbox,
        confidence: 1, // Docling doesn't provide confidence scores
        type,
      });
    }
  }
  
  // Process tables
  for (const table of doc.tables ?? []) {
    for (const prov of table.prov) {
      const dims = getPageDims(prov.page_no);
      const bbox = doclingBboxToNormalized(prov.bbox, dims.width, dims.height);
      
      tables.push({
        id: table.self_ref,
        page: prov.page_no,
        markdown: tableCellsToMarkdown(table.data.table_cells),
        bbox,
        confidence: 1,
      });
    }
  }
  
  // Process figures
  for (const fig of doc.figures ?? []) {
    for (const prov of fig.prov) {
      const dims = getPageDims(prov.page_no);
      const bbox = doclingBboxToNormalized(prov.bbox, dims.width, dims.height);
      
      blocks.push({
        id: fig.self_ref,
        page: prov.page_no,
        text: fig.caption ?? '',
        bbox,
        confidence: 1,
        type: 'figure',
      });
    }
  }
  
  // Calculate page count
  const allPages = [
    ...(doc.texts?.flatMap(t => t.prov.map(p => p.page_no)) ?? []),
    ...(doc.tables?.flatMap(t => t.prov.map(p => p.page_no)) ?? []),
    ...(doc.figures?.flatMap(f => f.prov.map(p => p.page_no)) ?? []),
  ];
  const pageCount = allPages.length > 0 ? Math.max(...allPages) : 1;
  
  return {
    blocks,
    tables,
    pageCount,
  };
}
