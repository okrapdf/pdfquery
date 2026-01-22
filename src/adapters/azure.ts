import type { NormalizedBlock, NormalizedTable, AdapterResult } from './types';

/**
 * Azure Document Intelligence (Form Recognizer) adapter
 * 
 * SDK: @azure/ai-form-recognizer
 * Output: AnalyzeResult from beginAnalyzeDocument()
 * Bbox format: BoundingRegion.polygon - array of {x, y} points (pixels)
 * Normalization: Divide by page width/height
 */

export interface AzurePoint {
  x: number;
  y: number;
}

export interface AzureBoundingRegion {
  pageNumber: number;
  polygon: AzurePoint[];
}

export interface AzureSpan {
  offset: number;
  length: number;
}

export interface AzurePage {
  pageNumber: number;
  width: number;
  height: number;
  unit: 'inch' | 'pixel';
  lines?: AzureLine[];
  words?: AzureWord[];
}

export interface AzureLine {
  content: string;
  polygon?: AzurePoint[];
  spans?: AzureSpan[];
}

export interface AzureWord {
  content: string;
  polygon?: AzurePoint[];
  confidence: number;
  span?: AzureSpan;
}

export interface AzureTable {
  rowCount: number;
  columnCount: number;
  boundingRegions?: AzureBoundingRegion[];
  cells?: AzureTableCell[];
}

export interface AzureTableCell {
  rowIndex: number;
  columnIndex: number;
  content: string;
  boundingRegions?: AzureBoundingRegion[];
}

export interface AzureAnalyzeResult {
  content?: string;
  pages?: AzurePage[];
  tables?: AzureTable[];
}

function polygonToBbox(polygon: AzurePoint[], pageWidth: number, pageHeight: number) {
  if (polygon.length < 4) return null;
  const xs = polygon.map(p => p.x / pageWidth);
  const ys = polygon.map(p => p.y / pageHeight);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function fromAzure(result: AzureAnalyzeResult): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const tables: NormalizedTable[] = [];
  
  // Build page dimensions map
  const pageDims = new Map<number, { width: number; height: number }>();
  for (const page of result.pages ?? []) {
    pageDims.set(page.pageNumber, { width: page.width, height: page.height });
  }
  
  let blockId = 0;
  
  // Process lines from each page
  for (const page of result.pages ?? []) {
    const { width, height } = pageDims.get(page.pageNumber) ?? { width: 1, height: 1 };
    
    for (const line of page.lines ?? []) {
      if (!line.polygon) continue;
      const bbox = polygonToBbox(line.polygon, width, height);
      if (!bbox) continue;
      
      blocks.push({
        id: `azure-line-${blockId++}`,
        page: page.pageNumber,
        text: line.content,
        bbox,
        confidence: 1, // Azure doesn't provide line-level confidence
        type: 'line',
      });
    }
    
    for (const word of page.words ?? []) {
      if (!word.polygon) continue;
      const bbox = polygonToBbox(word.polygon, width, height);
      if (!bbox) continue;
      
      blocks.push({
        id: `azure-word-${blockId++}`,
        page: page.pageNumber,
        text: word.content,
        bbox,
        confidence: word.confidence,
        type: 'word',
      });
    }
  }
  
  // Process tables
  for (const table of result.tables ?? []) {
    const region = table.boundingRegions?.[0];
    if (!region?.polygon) continue;
    
    const dims = pageDims.get(region.pageNumber) ?? { width: 1, height: 1 };
    const bbox = polygonToBbox(region.polygon, dims.width, dims.height);
    if (!bbox) continue;
    
    // Build markdown from cells
    const rows: string[][] = [];
    for (const cell of table.cells ?? []) {
      if (!rows[cell.rowIndex]) rows[cell.rowIndex] = [];
      rows[cell.rowIndex][cell.columnIndex] = cell.content;
    }
    
    let markdown = '';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] ?? [];
      markdown += '| ' + row.join(' | ') + ' |\n';
      if (i === 0) {
        markdown += '|' + row.map(() => '---').join('|') + '|\n';
      }
    }
    
    tables.push({
      id: `azure-table-${blockId++}`,
      page: region.pageNumber,
      markdown: markdown.trim(),
      bbox,
      confidence: 1,
    });
  }
  
  return {
    blocks,
    tables,
    pageCount: result.pages?.length ?? 1,
  };
}
