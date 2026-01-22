import type { NormalizedBlock, NormalizedTable, AdapterResult } from './types';

export interface TextractBoundingBox {
  Width: number;
  Height: number;
  Left: number;
  Top: number;
}

export interface TextractGeometry {
  BoundingBox: TextractBoundingBox;
}

export interface TextractBlock {
  Id: string;
  BlockType: 'PAGE' | 'LINE' | 'WORD' | 'TABLE' | 'CELL' | 'KEY_VALUE_SET' | string;
  Text?: string;
  Confidence?: number;
  Geometry?: TextractGeometry;
  Page?: number;
}

export interface TextractResponse {
  Blocks: TextractBlock[];
  DocumentMetadata?: { Pages: number };
}

export function fromTextract(response: TextractResponse): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const tables: NormalizedTable[] = [];
  
  for (const block of response.Blocks) {
    if (!block.Geometry?.BoundingBox) continue;
    
    const { Left, Top, Width, Height } = block.Geometry.BoundingBox;
    const bbox = { x: Left, y: Top, width: Width, height: Height };
    const page = block.Page ?? 1;
    
    if (block.BlockType === 'TABLE') {
      tables.push({
        id: block.Id,
        page,
        markdown: '',
        bbox,
        confidence: (block.Confidence ?? 100) / 100,
      });
    } else if (block.BlockType === 'LINE' || block.BlockType === 'WORD') {
      blocks.push({
        id: block.Id,
        page,
        text: block.Text ?? '',
        bbox,
        confidence: (block.Confidence ?? 100) / 100,
        type: block.BlockType === 'LINE' ? 'line' : 'word',
      });
    }
  }
  
  return {
    blocks,
    tables,
    pageCount: response.DocumentMetadata?.Pages ?? 1,
  };
}
