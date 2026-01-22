/**
 * Shared types for vendor adapters.
 * 
 * Each vendor outputs different JSON structures. These types represent
 * the serialized output that gets passed between services (often via JSON files
 * or API responses). We keep them loose since vendors may change their schemas.
 */

export interface NormalizedBbox {
  x: number;      // 0-1 normalized left
  y: number;      // 0-1 normalized top
  width: number;  // 0-1 normalized width
  height: number; // 0-1 normalized height
}

export interface NormalizedBlock {
  id: string;
  page: number;
  text: string;
  bbox: NormalizedBbox;
  confidence: number;
  type?: 'word' | 'line' | 'paragraph' | 'table' | 'figure' | 'other';
}

export interface NormalizedTable {
  id: string;
  page: number;
  markdown: string;
  bbox: NormalizedBbox;
  confidence: number;
}

export interface AdapterResult {
  blocks: NormalizedBlock[];
  tables: NormalizedTable[];
  pageCount: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}
