import type { NormalizedBlock, NormalizedTable, AdapterResult } from './types';

export interface DocAINormalizedVertex {
  x: number;
  y: number;
}

export interface DocAIBoundingPoly {
  normalizedVertices: DocAINormalizedVertex[];
}

export interface DocAILayout {
  textAnchor?: { textSegments?: Array<{ startIndex?: string; endIndex?: string }> };
  boundingPoly?: DocAIBoundingPoly;
  confidence?: number;
}

export interface DocAIBlock {
  layout?: DocAILayout;
}

export interface DocAIPage {
  pageNumber?: number;
  blocks?: DocAIBlock[];
  lines?: Array<{ layout?: DocAILayout }>;
  tokens?: Array<{ layout?: DocAILayout }>;
  tables?: Array<{ layout?: DocAILayout; bodyRows?: unknown[] }>;
}

export interface DocAIDocument {
  text?: string;
  pages?: DocAIPage[];
}

function vertexToBbox(vertices: DocAINormalizedVertex[]) {
  if (vertices.length < 4) return null;
  const xs = vertices.map(v => v.x);
  const ys = vertices.map(v => v.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function fromDocAI(doc: DocAIDocument): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const tables: NormalizedTable[] = [];
  const fullText = doc.text ?? '';
  
  let blockId = 0;
  for (const page of doc.pages ?? []) {
    const pageNum = page.pageNumber ?? 1;
    
    for (const line of page.lines ?? []) {
      if (!line.layout?.boundingPoly?.normalizedVertices) continue;
      const bbox = vertexToBbox(line.layout.boundingPoly.normalizedVertices);
      if (!bbox) continue;
      
      const segments = line.layout.textAnchor?.textSegments ?? [];
      let text = '';
      for (const seg of segments) {
        const start = parseInt(seg.startIndex ?? '0', 10);
        const end = parseInt(seg.endIndex ?? '0', 10);
        text += fullText.slice(start, end);
      }
      
      blocks.push({
        id: `docai-line-${blockId++}`,
        page: pageNum,
        text: text.trim(),
        bbox,
        confidence: line.layout.confidence ?? 1,
        type: 'line',
      });
    }
    
    for (const table of page.tables ?? []) {
      if (!table.layout?.boundingPoly?.normalizedVertices) continue;
      const bbox = vertexToBbox(table.layout.boundingPoly.normalizedVertices);
      if (!bbox) continue;
      
      tables.push({
        id: `docai-table-${blockId++}`,
        page: pageNum,
        markdown: '',
        bbox,
        confidence: table.layout.confidence ?? 1,
      });
    }
  }
  
  return {
    blocks,
    tables,
    pageCount: doc.pages?.length ?? 1,
  };
}
