/**
 * Virtual DOM Types
 *
 * A flat, queryable document representation:
 *   Document → Pages → Entities
 *
 * Inspired by jQuery's approach: treat the document as a database,
 * and queries become SQL-like operations.
 */
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
type EntityType = 'ocr' | 'table' | 'figure' | 'footnote' | 'markdown' | 'table_row' | 'table_cell' | 'currency' | 'percentage' | 'date' | 'text' | 'number' | 'header' | 'label' | 'total' | 'subtotal' | 'unknown';
type VerificationStatus = 'pending' | 'verified' | 'flagged' | 'rejected' | 'skipped';
interface BoundingBox {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
}
interface EntityMeta {
    verified: boolean;
    verificationStatus: VerificationStatus;
    verifiedBy?: string;
    verifiedAt?: number;
    confidence: number;
    wasCorrected: boolean;
    correctionType?: string;
    source: 'ocr' | 'user_edit' | 'ai_correction' | 'system';
    processorType?: 'ocr' | 'form' | 'layout' | 'gemini' | 'llamaparse';
    flagReason?: string;
    flaggedBy?: string;
    flaggedAt?: number;
    highlight?: boolean;
    selected?: boolean;
    [key: string]: unknown;
}
/**
 * Result from entity-to-markdown transformation via VLM.
 * Stored on entity._data.transformation after calling .markdown()
 */
interface TransformationResult {
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
interface EntityDataStore {
    /** VLM transformation result */
    transformation?: TransformationResult;
    /** Any additional cached/computed data */
    [key: string]: unknown;
}
interface VirtualEntity {
    id: string;
    type: EntityType;
    text: string;
    value?: string | number;
    bbox: BoundingBox;
    meta: EntityMeta;
    pageIndex: number;
    tableId?: string;
    rowIndex?: number;
    colIndex?: number;
    _data?: EntityDataStore;
}
interface PageMeta {
    totalEntities: number;
    verifiedCount: number;
    flaggedCount: number;
    pendingCount: number;
    avgConfidence: number;
    verificationScore: number;
}
interface VirtualPage {
    id: string;
    pageIndex: number;
    pageNumber: number;
    entities: VirtualEntity[];
    meta: PageMeta;
    markdown?: string;
    width?: number;
    height?: number;
}
interface DocumentMeta {
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
interface VirtualDoc {
    id: string;
    version: number;
    pages: VirtualPage[];
    meta: DocumentMeta;
}
type EntityPredicate = (entity: VirtualEntity) => boolean;
type Selector = string | EntityPredicate;
interface QueryStats {
    total: number;
    verified: number;
    flagged: number;
    pending: number;
    score: number;
    avgConfidence: number;
}
interface SourceTable {
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
interface SourceEntity {
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
interface SourceExtractedEntity {
    id: string;
    type: 'table' | 'figure' | 'footnote' | 'summary' | 'signature' | string;
    title: string;
    page: number;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    schema?: string[];
    isComplete?: boolean;
    caption?: string;
    imageUrl?: string;
    confidence?: number;
    verification_status?: VerificationStatus;
}
/** Raw OCR text block from OCR engine */
interface SourceOcr {
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
interface SourceMarkdown {
    id: string;
    page: number;
    content: string;
    model?: string;
    confidence?: number;
    verification_status?: VerificationStatus;
}
/** Entity counts from API response */
interface EntityCounts {
    tables: number;
    figures: number;
    footnotes: number;
    summaries: number;
    signatures?: number;
}
interface CompilerOptions {
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
interface QueryConfig {
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
interface QueryResultItem {
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
    position?: {
        row: number;
        col: number;
    };
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
interface QueryResponse {
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
interface DocumentInfo {
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

/**
 * DocCompiler - Transforms source data into VirtualDoc
 *
 * Compiles markdown tables and extracted entities into a flat,
 * queryable document structure: Document → Pages → Entities
 *
 * Usage:
 *   const compiler = new DocCompiler({ documentId: 'doc_123' });
 *   compiler.addTables(tablesFromApi);
 *   compiler.addEntities(entitiesFromApi);
 *   const doc = compiler.compile();
 */

declare class DocCompiler {
    private options;
    private tables;
    private entities;
    private extractedEntities;
    private ocrBlocks;
    private markdownBlocks;
    private version;
    constructor(options?: CompilerOptions);
    /**
     * Add extracted tables from API response
     */
    addTables(tables: SourceTable[]): this;
    /**
     * Add extracted entities from API response
     */
    addEntities(entities: SourceEntity[]): this;
    /**
     * Add extracted entities from /api/ocr/jobs/{id}/entities
     * Unified format for tables, figures, footnotes, summaries
     */
    addExtractedEntities(entities: SourceExtractedEntity[]): this;
    /**
     * Add raw OCR text blocks
     */
    addOcrBlocks(blocks: SourceOcr[]): this;
    /**
     * Add LLM vision markdown output
     */
    addMarkdownBlocks(blocks: SourceMarkdown[]): this;
    /**
     * Add a single markdown page (for direct markdown input)
     */
    addMarkdownPage(markdown: string, pageNumber: number): this;
    /**
     * Reset compiler state for reuse
     */
    reset(): this;
    /**
     * Compile all added data into a VirtualDoc
     */
    compile(): VirtualDoc;
    private buildPage;
    private tableToEntity;
    private parseTableCells;
    private sourceEntityToVirtual;
    /**
     * Convert unified extracted entity (table, figure, footnote, summary) to VirtualEntity
     */
    private extractedEntityToVirtual;
    /**
     * Convert OCR block to VirtualEntity
     */
    private ocrBlockToVirtual;
    /**
     * Convert LLM vision markdown output to VirtualEntity
     */
    private markdownBlockToVirtual;
    private buildMeta;
    private parseValue;
    private calculatePageMeta;
}
/**
 * Create a new DocCompiler instance
 */
declare function createCompiler(options?: CompilerOptions): DocCompiler;
/**
 * Quick compile from tables and entities
 */
declare function compileDocument(tables: SourceTable[], entities: SourceEntity[], options?: CompilerOptions): VirtualDoc;

/**
 * Virtual DOM Query Layer
 *
 * jQuery-like query engine for VirtualDoc structures.
 * Supports both read operations AND mutations via .attr().
 *
 * @example
 * const $$ = createQueryEngine(doc);
 *
 * // Read operations
 * $$('.currency').stats();
 * $$('[confidence>0.9]').texts();
 * $$('*').onPage(2).countByType();
 *
 * // Mutations (jQuery-style .attr())
 * $$('.table[confidence>0.9]').attr('verified', true);
 * $$('[confidence<0.7]').attr({ flagReason: 'low confidence' });
 *
 * // Get changes for DB sync
 * const log = $$('.table').attr('verified', true).getMutationLog();
 */

interface EntityChange {
    entityId: string;
    pageIndex: number;
    field: string;
    oldValue: unknown;
    newValue: unknown;
    timestamp: number;
}
interface MutationLog {
    docId: string;
    docVersion: number;
    changes: EntityChange[];
    createdAt: number;
}
declare class QueryResult {
    readonly elements: VirtualEntity[];
    readonly length: number;
    private doc;
    private mutationLog;
    constructor(entities: VirtualEntity[], doc: VirtualDoc);
    /**
     * Filter by type, predicate, or attribute selector
     *
     * @example
     * .filter('currency')                    // By type string
     * .filter(e => e.meta.confidence > 0.9)  // By predicate
     * .filter('[verified=true]')             // By attribute selector
     */
    filter(selector: Selector): QueryResult;
    /**
     * Exclude entities matching the selector
     */
    not(selector: Selector): QueryResult;
    /**
     * Find entities that contain specific text (case-insensitive)
     */
    contains(text: string): QueryResult;
    /**
     * Find entities matching a regex pattern
     */
    matches(pattern: RegExp): QueryResult;
    /**
     * Get entities on a specific page (1-indexed)
     */
    onPage(pageNumber: number): QueryResult;
    /**
     * Get entities within a specific table
     */
    inTable(tableId: string): QueryResult;
    /**
     * Get first N entities
     */
    take(n: number): QueryResult;
    /**
     * Skip first N entities
     */
    skip(n: number): QueryResult;
    /**
     * Get first entity (or undefined)
     */
    first(): VirtualEntity | undefined;
    /**
     * Get last entity (or undefined)
     */
    last(): VirtualEntity | undefined;
    /**
     * Get entity at index (returns QueryResult for chaining)
     */
    eq(index: number): QueryResult;
    /**
     * Get entity by ID
     */
    byId(id: string): QueryResult;
    /**
     * Sort by a key or comparator function
     */
    sortBy(key: keyof VirtualEntity | ((e: VirtualEntity) => number | string)): QueryResult;
    /**
     * Sort by confidence (descending - highest first)
     */
    sortByConfidence(): QueryResult;
    /**
     * Sort by position (top to bottom, left to right)
     */
    sortByPosition(): QueryResult;
    /**
     * Get or set arbitrary data on selected entities (jQuery-style .data())
     *
     * GET: .data('key') returns value from first element's _data store
     * SET: .data('key', value) sets on ALL selected elements, returns this
     * SET (object): .data({ key1: val1, key2: val2 }) sets multiple
     *
     * Falls back to meta for backward compatibility when getting.
     */
    data(key: string): unknown;
    data(key: string, value: unknown): QueryResult;
    data(values: Record<string, unknown>): QueryResult;
    /**
     * Get text content of first element
     */
    text(): string | undefined;
    /**
     * Get or set attributes on selected entities (jQuery-style)
     *
     * GET: Returns attribute value from first element
     *   $$('.table').attr('confidence')     → 0.95
     *   $$('.table').attr('verified')       → true
     *
     * SET (single): Sets attribute on ALL selected elements, returns this for chaining
     *   $$('.table').attr('verified', true)
     *   $$('[confidence<0.8]').attr('flagReason', 'low confidence')
     *
     * SET (object): Sets multiple attributes on ALL selected elements
     *   $$('.table').attr({ verified: true, verifiedBy: 'user_123' })
     *
     * Supported attributes (meta fields):
     *   - verified: boolean
     *   - verificationStatus: 'pending' | 'verified' | 'flagged' | 'rejected'
     *   - verifiedBy: string
     *   - verifiedAt: number (timestamp)
     *   - confidence: number (0-1)
     *   - wasCorrected: boolean
     *   - correctionType: string
     *   - flagReason: string
     *   - flaggedBy: string
     *   - flaggedAt: number (timestamp)
     *   - highlight: boolean
     *   - selected: boolean
     *
     * Entity fields:
     *   - text: string
     *   - value: string | number
     *   - type: EntityType
     *
     * @example
     * // Verify all high-confidence tables
     * $$('.table[confidence>0.9]').attr({
     *   verified: true,
     *   verificationStatus: 'verified',
     *   verifiedBy: 'auto_verify',
     *   verifiedAt: Date.now(),
     * });
     *
     * // Flag low-confidence entities
     * $$('[confidence<0.7]').attr({
     *   verificationStatus: 'flagged',
     *   flagReason: 'low OCR confidence',
     *   flaggedAt: Date.now(),
     * });
     *
     * // Correct a value
     * $$('#entity_123').attr('text', 'Corrected Text').attr('wasCorrected', true);
     */
    attr(key: string): unknown;
    attr(key: string, value: unknown): QueryResult;
    attr(attrs: Record<string, unknown>): QueryResult;
    /**
     * Get attribute value from first element
     */
    private getAttr;
    /**
     * Set attributes on all selected entities
     */
    private setAttrs;
    /**
     * Get attribute from a specific entity
     */
    private getEntityAttr;
    /**
     * Set attribute on a specific entity
     */
    private setEntityAttr;
    /**
     * Get all changes made to selected entities
     *
     * @example
     * const $tables = $$('.table').attr('verified', true);
     * console.log($tables.changes());
     * // [{ entityId: 't_1', field: 'verified', oldValue: false, newValue: true, ... }]
     */
    changes(): EntityChange[];
    /**
     * Get mutation log for persistence/sync
     *
     * @example
     * const log = $$('.table').attr('verified', true).getMutationLog();
     * await syncChangesToDb(log);
     */
    getMutationLog(): MutationLog;
    /**
     * Clear mutation log (call after syncing to DB)
     */
    clearChanges(): QueryResult;
    /**
     * Check if there are unsaved changes
     */
    hasChanges(): boolean;
    /**
     * Remove attributes from selected entities
     *
     * @example
     * $$('.table').removeAttr('flagReason');
     * $$('.flagged').removeAttr(['flagReason', 'flaggedBy', 'flaggedAt']);
     */
    removeAttr(key: string | string[]): QueryResult;
    /**
     * Toggle a boolean attribute
     *
     * @example
     * $$('.table').toggleAttr('verified');
     * $$('.table').toggleAttr('highlight', true);  // Force to true
     */
    toggleAttr(key: string, force?: boolean): QueryResult;
    /**
     * Get array of all text values
     */
    texts(): string[];
    /**
     * Get array of parsed numeric values
     */
    values(): (string | number | undefined)[];
    /**
     * Get array of entity IDs
     */
    ids(): string[];
    /**
     * Get array of entity types
     */
    types(): EntityType[];
    /**
     * Execute a function for each entity
     */
    each(fn: (entity: VirtualEntity, index: number) => void): QueryResult;
    /**
     * Map entities to a new array
     */
    map<T>(fn: (entity: VirtualEntity, index: number) => T): T[];
    /**
     * Reduce entities to a single value
     */
    reduce<T>(fn: (acc: T, entity: VirtualEntity, index: number) => T, initial: T): T;
    /**
     * Check if any entity matches predicate
     */
    some(predicate: (entity: VirtualEntity) => boolean): boolean;
    /**
     * Check if all entities match predicate
     */
    every(predicate: (entity: VirtualEntity) => boolean): boolean;
    /**
     * Find first entity matching predicate
     */
    find(predicate: (entity: VirtualEntity) => boolean): VirtualEntity | undefined;
    /**
     * Calculate statistics for the selection
     */
    stats(): QueryStats;
    /**
     * Sum numeric values
     */
    sum(): number;
    /**
     * Average numeric values
     */
    avg(): number;
    /**
     * Get minimum numeric value
     */
    min(): number | undefined;
    /**
     * Get maximum numeric value
     */
    max(): number | undefined;
    /**
     * Count total entities
     */
    count(): number;
    /**
     * Group entities by a key function
     */
    groupBy<K extends string | number>(keyFn: (entity: VirtualEntity) => K): Map<K, QueryResult>;
    /**
     * Group by page number (1-indexed)
     */
    groupByPage(): Map<number, QueryResult>;
    /**
     * Group by entity type
     */
    groupByType(): Map<EntityType, QueryResult>;
    /**
     * Count entities by type
     */
    countByType(): Map<EntityType, number>;
    /**
     * Count entities by page
     */
    countByPage(): Map<number, number>;
    /**
     * Get raw entity array (copy)
     */
    toArray(): VirtualEntity[];
    /**
     * Get JSON string representation
     */
    json(): string;
    /**
     * Render entities to HTML string (like jQuery's .html())
     *
     * @example
     * $$('.table').html()           // Render tables as HTML
     * $$('*').onPage(1).html()      // Render all page 1 entities
     */
    html(options?: RenderOptions): string;
    /**
     * Render as HTML document with head/body
     */
    htmlDocument(options?: RenderOptions): string;
    /**
     * Render grouped by page (like a document view)
     */
    htmlByPage(options?: RenderOptions): string;
    /**
     * Get the parent document
     */
    getDoc(): VirtualDoc;
    /**
     * Transform first entity to markdown using VLM (like jQuery's .text() but AI-powered)
     *
     * Calls /api/transform/entity-to-markdown with the entity's image.
     * Stores full response on entity._data.transformation for later access.
     * Returns cached result if available (use force: true to bypass).
     *
     * @example
     * const markdown = await $$('.table:first').markdown();
     * const result = $$('.table:first').data('transformation'); // { markdown, model, tokens }
     */
    markdown(options?: {
        imageUrl?: string;
        model?: string;
        promptStyle?: 'table' | 'page' | 'json';
        apiEndpoint?: string;
        force?: boolean;
    }): Promise<string>;
}
interface RenderOptions {
    /** Include entity metadata as data attributes */
    includeMetadata?: boolean;
    /** Include confidence badges */
    showConfidence?: boolean;
    /** Include verification status badges */
    showStatus?: boolean;
    /** Render tables as actual HTML tables (not markdown) */
    renderTables?: boolean;
    /** Custom class prefix (default: 'okra') */
    classPrefix?: string;
}
type QueryEngine = (selector?: Selector) => QueryResult;
/**
 * Create a query engine bound to a document
 *
 * @example
 * const $$ = createQueryEngine(doc);
 * $$('.currency').stats();
 * $$('[confidence>0.9]').texts();
 * $$('*').onPage(2).countByType();
 */
declare function createQueryEngine(doc: VirtualDoc): QueryEngine;
/**
 * Query a specific page
 */
declare function queryPage(doc: VirtualDoc, pageNumber: number): QueryResult;
/**
 * Query across multiple pages
 */
declare function queryPages(doc: VirtualDoc, pageNumbers: number[]): QueryResult;
/**
 * Execute a query with config and return serializable response
 *
 * This is the main interface for CLI/API/Search consumers.
 * Takes a QueryConfig and returns a QueryResponse.
 *
 * @example
 * // CLI usage
 * const doc = compile(sources);
 * const response = executeQuery(doc, {
 *   selector: '.currency',
 *   topK: 10,
 *   minConfidence: 0.8,
 *   sortBy: 'confidence',
 * });
 * console.log(JSON.stringify(response));
 *
 * @example
 * // API handler
 * app.post('/query', (req, res) => {
 *   const doc = await loadDocument(req.body.documentId);
 *   const response = executeQuery(doc, req.body);
 *   res.json(response);
 * });
 */
declare function executeQuery(doc: VirtualDoc, config: QueryConfig): QueryResponse;
/**
 * Format query response for text output (like semtools search output)
 */
declare function formatQueryResponse(response: QueryResponse, options?: {
    showStats?: boolean;
    maxTextLength?: number;
}): string;

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

/** Response from /api/ocr/jobs/{id}/entities?type=all */
interface EntitiesApiResponse {
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
interface ApiEntity {
    id: string;
    type: 'table' | 'figure' | 'footnote' | 'summary';
    title: string;
    page: number;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    schema?: string[];
    isComplete?: boolean;
    caption?: string;
    imageUrl?: string;
    confidence?: number;
    verification_status?: string;
}
/** Response from /api/ocr/jobs/{id}/pages/{n} */
interface PageApiResponse {
    page: number;
    blocks: ApiBlock[];
    content: string;
    has_tables: boolean;
    metadata: {
        has_tables: boolean;
        tables: ApiTableMeta[];
        figures: ApiFigureMeta[];
        footnotes: ApiFootnoteMeta[];
        extracted_at: string;
    };
    dimension: {
        width: number;
        height: number;
    } | null;
}
interface ApiBlock {
    text: string;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    confidence?: number;
}
interface ApiTableMeta {
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    title: string;
    schema: string[];
    is_complete: boolean;
}
interface ApiFigureMeta {
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    title?: string;
    caption?: string;
}
interface ApiFootnoteMeta {
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    text: string;
}
/**
 * Convert entities API response to SourceExtractedEntity[]
 */
declare function fromEntitiesApi(response: EntitiesApiResponse): SourceExtractedEntity[];
/**
 * Convert page API response to OCR blocks
 */
declare function fromPageApiBlocks(response: PageApiResponse): SourceOcr[];
/**
 * Convert page API response to markdown block
 */
declare function fromPageApiMarkdown(response: PageApiResponse): SourceMarkdown;
/**
 * Convert page metadata tables to SourceTable[]
 * Note: These don't have markdown content, just metadata
 */
declare function fromPageApiTables(response: PageApiResponse): Partial<SourceTable>[];
interface FetchOptions {
    headers?: Record<string, string>;
}
/**
 * Fetch entities from OkraPDF API
 */
declare function fetchEntities(jobId: string, baseUrl?: string, options?: FetchOptions): Promise<SourceExtractedEntity[]>;
/**
 * Fetch a single page from OkraPDF API
 */
declare function fetchPage(jobId: string, pageNumber: number, baseUrl?: string, options?: FetchOptions): Promise<{
    ocr: SourceOcr[];
    markdown: SourceMarkdown;
}>;
/**
 * Fetch multiple pages in parallel
 */
declare function fetchPages(jobId: string, pageNumbers: number[], baseUrl?: string, options?: FetchOptions): Promise<{
    ocr: SourceOcr[];
    markdown: SourceMarkdown[];
}>;
/**
 * Load entities from a JSON file
 */
declare function loadEntitiesFromFile(json: unknown): SourceExtractedEntity[];
/**
 * Load page data from a JSON file
 */
declare function loadPageFromFile(json: unknown): {
    ocr: SourceOcr[];
    markdown: SourceMarkdown;
    page: number;
};

interface InspectorBbox {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface InspectorTreeNode {
    id: string;
    type: string;
    tagName: string;
    textContent: string | null;
    page: number;
    bbox?: InspectorBbox;
    children: InspectorTreeNode[];
    className?: string;
    attributes: Record<string, unknown>;
    data?: Record<string, unknown>;
}
interface TreeAdapterOptions {
    docId?: string;
    includeOcrBlocks?: boolean;
    defaultConfidence?: number;
}
declare function treeToVirtualDoc(tree: InspectorTreeNode, options?: TreeAdapterOptions): VirtualDoc;
declare function getPageCount(tree: InspectorTreeNode): number;

export { type ApiBlock, type ApiEntity, type BoundingBox, type CompilerOptions, DocCompiler, type DocumentInfo, type DocumentMeta, type EntitiesApiResponse, type EntityChange, type EntityCounts, type EntityMeta, type EntityType, type InspectorTreeNode, type MutationLog, type PageApiResponse, type PageMeta, type QueryConfig, type QueryEngine, type QueryResponse, QueryResult, type QueryResultItem, type QueryStats, type RenderOptions, type Selector, type SourceEntity, type SourceExtractedEntity, type SourceMarkdown, type SourceOcr, type SourceTable, type TreeAdapterOptions, type VerificationStatus, type VirtualDoc, type VirtualEntity, type VirtualPage, compileDocument, createCompiler, createQueryEngine, executeQuery, fetchEntities, fetchPage, fetchPages, formatQueryResponse, fromEntitiesApi, fromPageApiBlocks, fromPageApiMarkdown, fromPageApiTables, getPageCount, loadEntitiesFromFile, loadPageFromFile, queryPage, queryPages, treeToVirtualDoc };
