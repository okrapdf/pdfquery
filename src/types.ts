/**
 * Virtual DOM Types
 *
 * A flat, queryable document representation:
 *   Document → Pages → Entities
 *
 * Inspired by jQuery's approach: treat the document as a database,
 * and queries become SQL-like operations.
 */

// ============================================================================
// Entity Types
// ============================================================================

/**
 * Entity types for document elements.
 *
 * Structure: Document → Page[] → Entity[] (flat, no nesting)
 *
 * Selector mapping (jQuery-style):
 *   $$('.ocr')       - Raw OCR text blocks
 *   $$('.table')     - Extracted tables
 *   $$('.figure')    - Charts, images, diagrams
 *   $$('.footnote')  - Footnotes/endnotes
 *   $$('.markdown')  - LLM vision markdown output
 */
export type EntityType =
  // Page-level extractions (flat, no nesting between these)
  | 'ocr'             // Raw OCR text block
  | 'table'           // Markdown table
  | 'figure'          // Chart, image, diagram
  | 'footnote'        // Footnote/endnote
  | 'markdown'        // LLM vision markdown output

  // Cell-level types (parsed from tables/ocr)
  | 'table_row'
  | 'table_cell'
  | 'currency'
  | 'percentage'
  | 'date'
  | 'text'
  | 'number'

  // Semantic labels
  | 'header'
  | 'label'
  | 'total'
  | 'subtotal'
  | 'unknown';

export type VerificationStatus =
  | 'pending'
  | 'verified'
  | 'flagged'
  | 'rejected'
  | 'skipped';

// ============================================================================
// Bounding Box
// ============================================================================

export interface BoundingBox {
  xmin: number;  // 0-1 or 0-1000 normalized
  ymin: number;
  xmax: number;
  ymax: number;
}

// ============================================================================
// Entity Metadata
// ============================================================================

export interface EntityMeta {
  // Verification state
  verified: boolean;
  verificationStatus: VerificationStatus;
  verifiedBy?: string;
  verifiedAt?: number;  // Unix timestamp

  // OCR confidence
  confidence: number;   // 0-1

  // Correction tracking
  wasCorrected: boolean;
  correctionType?: string;

  // Source tracking
  source: 'ocr' | 'user_edit' | 'ai_correction' | 'system';
  processorType?: 'ocr' | 'form' | 'layout' | 'gemini' | 'llamaparse';

  // Flags
  flagReason?: string;
  flaggedBy?: string;
  flaggedAt?: number;

  // User-defined metadata (extensible)
  highlight?: boolean;
  selected?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// Transformation Results (for VLM entity-to-markdown)
// ============================================================================

/**
 * Result from entity-to-markdown transformation via VLM.
 * Stored on entity._data.transformation after calling .markdown()
 */
export interface TransformationResult {
  success: boolean;
  markdown: string;
  model: string;
  tokens: {
    input: number;
    output: number;
  };
  timestamp: number;
  promptStyle?: 'table' | 'page' | 'json';
}

/**
 * Arbitrary data store for entities (jQuery-style .data())
 * Supports caching transformation results, user annotations, etc.
 */
export interface EntityDataStore {
  /** VLM transformation result */
  transformation?: TransformationResult;
  /** Any additional cached/computed data */
  [key: string]: unknown;
}

// ============================================================================
// Virtual Entity
// ============================================================================

export interface VirtualEntity {
  id: string;
  type: EntityType;
  text: string;               // Raw text content
  value?: string | number;    // Parsed value (if applicable)
  bbox: BoundingBox;
  meta: EntityMeta;

  // Parent references (flat structure, no nesting)
  pageIndex: number;
  tableId?: string;           // If entity belongs to a table
  rowIndex?: number;          // Row position within table
  colIndex?: number;          // Column position within table

  // jQuery-style arbitrary data store (for transformations, caching, etc.)
  _data?: EntityDataStore;
}

// ============================================================================
// Virtual Page
// ============================================================================

export interface PageMeta {
  totalEntities: number;
  verifiedCount: number;
  flaggedCount: number;
  pendingCount: number;
  avgConfidence: number;
  verificationScore: number;  // verifiedCount / totalEntities
}

export interface VirtualPage {
  id: string;
  pageIndex: number;          // 0-based
  pageNumber: number;         // 1-based (for display)
  entities: VirtualEntity[];
  meta: PageMeta;

  // Raw page content
  markdown?: string;          // LLM vision markdown output for this page

  // Page dimensions (if available)
  width?: number;
  height?: number;
}

// ============================================================================
// Virtual Document
// ============================================================================

export interface DocumentMeta {
  fileName?: string;
  documentType?: string;
  totalPages: number;
  totalEntities: number;
  verifiedCount: number;
  flaggedCount: number;
  pendingCount: number;
  verificationScore: number;
  createdAt: number;
  lastModified: number;
}

export interface VirtualDoc {
  id: string;
  version: number;            // Auto-increment for diffing
  pages: VirtualPage[];
  meta: DocumentMeta;
}

// ============================================================================
// Selector Types (for jQuery-like queries)
// ============================================================================

export type EntityPredicate = (entity: VirtualEntity) => boolean;

export type Selector =
  | string                    // '.currency', '[verified=true]', '*'
  | EntityPredicate;          // Custom filter function

// ============================================================================
// Query Result Statistics
// ============================================================================

export interface QueryStats {
  total: number;
  verified: number;
  flagged: number;
  pending: number;
  score: number;              // verified / total
  avgConfidence: number;
}

// ============================================================================
// Source Data Types (from existing API)
// ============================================================================

export interface SourceTable {
  id: string;
  page_number: number;
  markdown: string;
  bbox: {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  };
  confidence: number | null;
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  was_corrected?: boolean;
}

export interface SourceEntity {
  id: string;
  field_label: string;
  field_category: string | null;
  page_number: number;
  row_index: number | null;
  suggested_value: string;
  suggested_value_numeric: number | null;
  bounding_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  verification_status: VerificationStatus;
  verified_value: string | null;
  verified_at: string | null;
  was_corrected: boolean;
  flag_reason: string | null;
  flagged_at: string | null;
}

/**
 * Unified entity format from /api/ocr/jobs/{id}/entities
 *
 * All entity types (table, figure, footnote) share this base structure.
 * The `type` field discriminates between them.
 */
export interface SourceExtractedEntity {
  id: string;
  type: 'table' | 'figure' | 'footnote' | 'summary' | 'signature' | string;
  title: string;              // Text content or title
  page: number;               // 1-based page number
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  // Table-specific fields
  schema?: string[];          // Column headers for tables
  isComplete?: boolean;       // Whether table extraction is complete
  // Figure-specific fields
  caption?: string;           // Figure caption (separate from title)
  imageUrl?: string;          // URL to figure image
  // Common optional fields
  confidence?: number;
  verification_status?: VerificationStatus;
}

/** Raw OCR text block from OCR engine */
export interface SourceOcr {
  id: string;
  page: number;
  text: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  verification_status?: VerificationStatus;
}

/** LLM vision markdown output for a page */
export interface SourceMarkdown {
  id: string;
  page: number;
  content: string;            // Raw markdown from LLM vision
  model?: string;             // e.g., 'gpt-4-vision', 'gemini-pro-vision'
  confidence?: number;
  verification_status?: VerificationStatus;
}

/** Entity counts from API response */
export interface EntityCounts {
  tables: number;
  figures: number;
  footnotes: number;
  summaries: number;
  signatures?: number;
}

// ============================================================================
// Compiler Options
// ============================================================================

export interface CompilerOptions {
  /** Include raw markdown tables as entities */
  includeTables?: boolean;

  /** Parse table cells as individual entities */
  parseTableCells?: boolean;

  /** Auto-detect entity types from text patterns */
  autoDetectTypes?: boolean;

  /** Document ID to use */
  documentId?: string;

  /** Document filename */
  fileName?: string;

  /** Document type (e.g., 'financial_statement') */
  documentType?: string;
}

// ============================================================================
// Query Config & Results (for CLI/API/Search consumers)
// ============================================================================

/**
 * Query configuration - passed by consumers (CLI, API, search filter)
 *
 * @example
 * // CLI: okra-pdf "doc-id" ".table" --top-k=5
 * const config: QueryConfig = {
 *   selector: '.table',
 *   topK: 5,
 * };
 *
 * // API: POST /query { selector: '.currency', pageRange: [1, 10] }
 * const config: QueryConfig = {
 *   selector: '.currency',
 *   pageRange: [1, 10],
 * };
 */
export interface QueryConfig {
  /** jQuery-like selector string */
  selector: string;

  /** Maximum results to return (like semtools --top-k) */
  topK?: number;

  /** Filter to specific page range [start, end] inclusive */
  pageRange?: [number, number];

  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;

  /** Filter by verification status */
  status?: VerificationStatus | VerificationStatus[];

  /** Text search within results (case-insensitive) */
  contains?: string;

  /** Regex pattern to match */
  pattern?: string;

  /** Sort order */
  sortBy?: 'confidence' | 'position' | 'page';

  /** Output format */
  output?: 'json' | 'text' | 'html' | 'csv';

  /** Include N lines of context (for text output) */
  context?: number;
}

/**
 * Query result item - returned by query operations
 *
 * Designed to be serializable for CLI/API output.
 * Similar to semtools SearchResult.
 */
export interface QueryResultItem {
  /** Entity ID */
  id: string;

  /** Entity type */
  type: EntityType;

  /** Text content */
  text: string;

  /** Parsed value if numeric */
  value?: string | number;

  /** Page number (1-indexed) */
  page: number;

  /** Bounding box */
  bbox: BoundingBox;

  /** OCR confidence (0-1) */
  confidence: number;

  /** Verification status */
  status: VerificationStatus;

  /** Parent table ID if cell */
  tableId?: string;

  /** Row/column for table cells */
  position?: { row: number; col: number };
}

/**
 * Query response - complete response from query operations
 *
 * @example
 * // CLI output
 * {
 *   query: '.currency',
 *   total: 100,
 *   returned: 10,
 *   items: [...],
 *   stats: { avgConfidence: 0.91, verified: 45 }
 * }
 */
export interface QueryResponse {
  /** Original selector */
  query: string;

  /** Document ID */
  documentId: string;

  /** Total matching entities */
  total: number;

  /** Number returned (after topK limit) */
  returned: number;

  /** Result items */
  items: QueryResultItem[];

  /** Aggregate statistics */
  stats: QueryStats;

  /** Execution time in ms */
  duration?: number;
}

/**
 * Document info - metadata about loaded document
 */
export interface DocumentInfo {
  /** Document ID */
  id: string;

  /** Source type */
  source: 'api' | 'file' | 'url';

  /** Original path/URL/ID */
  path: string;

  /** File name */
  fileName?: string;

  /** Total pages */
  totalPages: number;

  /** Total entities */
  totalEntities: number;

  /** Entity counts by type */
  counts: Record<EntityType, number>;
}
