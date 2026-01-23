import type { NormalizedBlock, NormalizedTable, AdapterResult } from './types';

/**
 * Unstructured.io adapter
 * 
 * SDK: unstructured-client or partition() from unstructured
 * Output: Element[] from partition()
 * Bbox format: metadata.coordinates.points - array of [x, y] tuples (pixels)
 * Normalization: Divide by metadata.coordinates.system.layout_width/height
 */

export interface UnstructuredCoordinates {
  points: [number, number][];
  system: string;
  layout_width: number;
  layout_height: number;
}

export interface UnstructuredMetadata {
  page_number?: number;
  coordinates?: UnstructuredCoordinates;
  detection_class_prob?: number;
  // Table-specific
  text_as_html?: string;
}

export interface UnstructuredElement {
  type: string;  // 'Title', 'NarrativeText', 'Table', 'Image', 'ListItem', etc.
  element_id: string;
  text: string;
  metadata: UnstructuredMetadata;
}

function pointsToBbox(coords: UnstructuredCoordinates) {
  const points = coords.points;
  if (points.length < 4) return null;
  
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  const { layout_width, layout_height } = coords;
  
  return {
    x: minX / layout_width,
    y: minY / layout_height,
    width: (maxX - minX) / layout_width,
    height: (maxY - minY) / layout_height,
  };
}

function htmlTableToMarkdown(html: string): string {
  // Simple HTML table → markdown conversion
  const rows: string[][] = [];
  
  // Extract rows
  const rowMatches = html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gis);
  for (const match of rowMatches) {
    const cellContent = match[1];
    const cells: string[] = [];
    const cellMatches = cellContent.matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis);
    for (const cell of cellMatches) {
      // Strip tags and clean up
      cells.push(cell[1].replace(/<[^>]*>/g, '').trim());
    }
    if (cells.length) rows.push(cells);
  }
  
  if (rows.length === 0) return '';
  
  let md = '';
  for (let i = 0; i < rows.length; i++) {
    md += '| ' + rows[i].join(' | ') + ' |\n';
    if (i === 0) {
      md += '|' + rows[i].map(() => '---').join('|') + '|\n';
    }
  }
  
  return md.trim();
}

export function fromUnstructured(elements: UnstructuredElement[]): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const tables: NormalizedTable[] = [];
  let maxPage = 1;
  
  for (const el of elements) {
    const page = el.metadata.page_number ?? 1;
    maxPage = Math.max(maxPage, page);
    
    if (!el.metadata.coordinates) continue;
    const bbox = pointsToBbox(el.metadata.coordinates);
    if (!bbox) continue;
    
    const confidence = el.metadata.detection_class_prob ?? 1;
    
    if (el.type === 'Table') {
      tables.push({
        id: el.element_id,
        page,
        markdown: el.metadata.text_as_html 
          ? htmlTableToMarkdown(el.metadata.text_as_html)
          : el.text,
        bbox,
        confidence,
      });
    } else {
      // Map Unstructured types to pdfquery types
      let type: NormalizedBlock['type'] = 'other';
      if (el.type === 'Title' || el.type === 'Header') type = 'paragraph';
      else if (el.type === 'NarrativeText' || el.type === 'Text') type = 'paragraph';
      else if (el.type === 'ListItem') type = 'paragraph';
      else if (el.type === 'Image' || el.type === 'Figure') type = 'figure';
      
      blocks.push({
        id: el.element_id,
        page,
        text: el.text,
        bbox,
        confidence,
        type,
      });
    }
  }
  
  return {
    blocks,
    tables,
    pageCount: maxPage,
  };
}
