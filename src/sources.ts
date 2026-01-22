/**
 * Source Adapters
 *
 * Normalize different API response formats into compiler-compatible types.
 * Like how browsers normalize different HTML sources before building the DOM.
 *
 * Supported sources:
 *   - OkraPDF API: /api/ocr/jobs/{id}/entities
 *   - OkraPDF API: /api/ocr/jobs/{id}/pages/{n}
 *   - JSON files (fixtures)
 *   - Raw markdown strings
 */

import type {
  SourceExtractedEntity,
  SourceOcr,
  SourceMarkdown,
  SourceTable,
} from './types';

// ============================================================================
// API Response Types (as received from endpoints)
// ============================================================================

/** Response from /api/ocr/jobs/{id}/entities?type=all */
export interface EntitiesApiResponse {
  jobId: string;
  entities: ApiEntity[];
  counts?: {
    tables: number;
    figures: number;
    footnotes: number;
    summaries: number;
  };
  /** Total pages in the document */
  totalPages?: number;
  /** Extraction status */
  extractionStatus?: 'not_started' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
  /** Data source */
  source?: 'workflow' | 'database';
}

/** Entity from entities API */
export interface ApiEntity {
  id: string;
  type: 'table' | 'figure' | 'footnote' | 'summary';
  title: string;
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  schema?: string[];       // tables
  isComplete?: boolean;    // tables
  caption?: string;        // figures
  imageUrl?: string;       // figures
  confidence?: number;
  verification_status?: string;
}

/** Response from /api/ocr/jobs/{id}/pages/{n} */
export interface PageApiResponse {
  page: number;
  blocks: ApiBlock[];
  content: string;         // LLM markdown
  has_tables: boolean;
  metadata: {
    has_tables: boolean;
    tables: ApiTableMeta[];
    figures: ApiFigureMeta[];
    footnotes: ApiFootnoteMeta[];
    extracted_at: string;
  };
  dimension: { width: number; height: number } | null;
}

export interface ApiBlock {
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence?: number;
}

export interface ApiTableMeta {
  bbox: { x: number; y: number; width: number; height: number };
  title: string;
  schema: string[];
  is_complete: boolean;
}

export interface ApiFigureMeta {
  bbox: { x: number; y: number; width: number; height: number };
  title?: string;
  caption?: string;
}

export interface ApiFootnoteMeta {
  bbox: { x: number; y: number; width: number; height: number };
  text: string;
}

// ============================================================================
// Source Adapters
// ============================================================================

/** Default bbox for entities without position data */
const DEFAULT_BBOX = { x: 0, y: 0, width: 1, height: 1 };

/**
 * Convert entities API response to SourceExtractedEntity[]
 */
export function fromEntitiesApi(response: EntitiesApiResponse): SourceExtractedEntity[] {
  return response.entities.map(entity => ({
    id: entity.id,
    type: entity.type,
    title: entity.title,
    page: entity.page,
    bbox: entity.bbox ?? DEFAULT_BBOX, // Handle missing bbox
    schema: entity.schema,
    isComplete: entity.isComplete,
    caption: entity.caption,
    imageUrl: entity.imageUrl,
    confidence: entity.confidence,
    verification_status: entity.verification_status as any,
  }));
}

/**
 * Convert page API response to OCR blocks
 */
export function fromPageApiBlocks(response: PageApiResponse): SourceOcr[] {
  return response.blocks.map((block, index) => ({
    id: `ocr-${response.page}-${index}`,
    page: response.page,
    text: block.text,
    bbox: block.bbox,
    confidence: block.confidence ?? 0.9,
  }));
}

/**
 * Convert page API response to markdown block
 */
export function fromPageApiMarkdown(response: PageApiResponse): SourceMarkdown {
  return {
    id: `md-${response.page}`,
    page: response.page,
    content: response.content,
    model: 'llamaparse',
    confidence: 0.95,
  };
}

/**
 * Convert page metadata tables to SourceTable[]
 * Note: These don't have markdown content, just metadata
 */
export function fromPageApiTables(response: PageApiResponse): Partial<SourceTable>[] {
  return response.metadata.tables.map((table, index) => ({
    id: `table-${response.page}-${index}`,
    page_number: response.page,
    markdown: '', // Not available from page API, need to extract from content
    bbox: {
      xmin: table.bbox.x,
      ymin: table.bbox.y,
      xmax: table.bbox.x + table.bbox.width,
      ymax: table.bbox.y + table.bbox.height,
    },
    confidence: 0.9,
    verification_status: 'pending' as const,
    verified_by: null,
    verified_at: null,
  }));
}

// ============================================================================
// Fetch Helpers
// ============================================================================

export interface FetchOptions {
  headers?: Record<string, string>;
}

/**
 * Fetch entities from OkraPDF API
 */
export async function fetchEntities(
  jobId: string,
  baseUrl = 'https://publicusercontent.okrapdf.com',
  options: FetchOptions = {}
): Promise<SourceExtractedEntity[]> {
  const url = `${baseUrl}/api/ocr/jobs/${jobId}/entities?type=all`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...options.headers },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch entities: ${response.status}`);
  }
  const data: EntitiesApiResponse = await response.json();
  return fromEntitiesApi(data);
}

/**
 * Fetch a single page from OkraPDF API
 */
export async function fetchPage(
  jobId: string,
  pageNumber: number,
  baseUrl = 'https://publicusercontent.okrapdf.com',
  options: FetchOptions = {}
): Promise<{ ocr: SourceOcr[]; markdown: SourceMarkdown }> {
  const url = `${baseUrl}/api/ocr/jobs/${jobId}/pages/${pageNumber}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...options.headers },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch page ${pageNumber}: ${response.status}`);
  }
  const data: PageApiResponse = await response.json();
  return {
    ocr: fromPageApiBlocks(data),
    markdown: fromPageApiMarkdown(data),
  };
}

/**
 * Fetch multiple pages in parallel
 */
export async function fetchPages(
  jobId: string,
  pageNumbers: number[],
  baseUrl = 'https://publicusercontent.okrapdf.com',
  options: FetchOptions = {}
): Promise<{ ocr: SourceOcr[]; markdown: SourceMarkdown[] }> {
  const results = await Promise.all(
    pageNumbers.map(n => fetchPage(jobId, n, baseUrl, options))
  );
  return {
    ocr: results.flatMap(r => r.ocr),
    markdown: results.map(r => r.markdown),
  };
}

// ============================================================================
// File Loaders (for fixtures/testing)
// ============================================================================

/**
 * Load entities from a JSON file
 */
export function loadEntitiesFromFile(json: unknown): SourceExtractedEntity[] {
  const data = json as EntitiesApiResponse;
  if (!data.entities) {
    throw new Error('Invalid entities file: missing entities array');
  }
  return fromEntitiesApi(data);
}

/**
 * Load page data from a JSON file
 */
export function loadPageFromFile(json: unknown): {
  ocr: SourceOcr[];
  markdown: SourceMarkdown;
  page: number;
} {
  const data = json as PageApiResponse;
  if (typeof data.page !== 'number') {
    throw new Error('Invalid page file: missing page number');
  }
  return {
    ocr: fromPageApiBlocks(data),
    markdown: fromPageApiMarkdown(data),
    page: data.page,
  };
}
