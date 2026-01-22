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

import type {
  VirtualDoc,
  VirtualEntity,
  EntityType,
  Selector,
  QueryStats,
  EntityMeta,
  QueryConfig,
  QueryResponse,
  QueryResultItem,
  TransformationResult,
  EntityDataStore,
} from './types';

// ============================================================================
// QueryResult Class
// ============================================================================

// ============================================================================
// Mutation Tracking
// ============================================================================

export interface EntityChange {
  entityId: string;
  pageIndex: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export interface MutationLog {
  docId: string;
  docVersion: number;
  changes: EntityChange[];
  createdAt: number;
}

export class QueryResult {
  readonly elements: VirtualEntity[];
  readonly length: number;
  private doc: VirtualDoc;
  private mutationLog: EntityChange[] = [];

  constructor(entities: VirtualEntity[], doc: VirtualDoc) {
    this.elements = entities;
    this.length = entities.length;
    this.doc = doc;
  }

  // ==========================================================================
  // SELECTORS & FILTERING
  // ==========================================================================

  /**
   * Filter by type, predicate, or attribute selector
   *
   * @example
   * .filter('currency')                    // By type string
   * .filter(e => e.meta.confidence > 0.9)  // By predicate
   * .filter('[verified=true]')             // By attribute selector
   */
  filter(selector: Selector): QueryResult {
    let filtered: VirtualEntity[];

    if (typeof selector === 'function') {
      filtered = this.elements.filter(selector);
    } else if (typeof selector === 'string') {
      filtered = this.elements.filter(e => matchesSelector(e, selector));
    } else {
      filtered = this.elements;
    }

    return new QueryResult(filtered, this.doc);
  }

  /**
   * Exclude entities matching the selector
   */
  not(selector: Selector): QueryResult {
    let filtered: VirtualEntity[];

    if (typeof selector === 'function') {
      filtered = this.elements.filter(e => !selector(e));
    } else if (typeof selector === 'string') {
      filtered = this.elements.filter(e => !matchesSelector(e, selector));
    } else {
      filtered = this.elements;
    }

    return new QueryResult(filtered, this.doc);
  }

  /**
   * Find entities that contain specific text (case-insensitive)
   */
  contains(text: string): QueryResult {
    const lower = text.toLowerCase();
    return new QueryResult(
      this.elements.filter(e => e.text && e.text.toLowerCase().includes(lower)),
      this.doc
    );
  }

  /**
   * Find entities matching a regex pattern
   */
  matches(pattern: RegExp): QueryResult {
    return new QueryResult(
      this.elements.filter(e => e.text && pattern.test(e.text)),
      this.doc
    );
  }

  /**
   * Get entities on a specific page (1-indexed)
   */
  onPage(pageNumber: number): QueryResult {
    const pageIndex = pageNumber - 1;
    return new QueryResult(
      this.elements.filter(e => e.pageIndex === pageIndex),
      this.doc
    );
  }

  /**
   * Get entities within a specific table
   */
  inTable(tableId: string): QueryResult {
    return new QueryResult(
      this.elements.filter(e => e.tableId === tableId),
      this.doc
    );
  }

  /**
   * Get first N entities
   */
  take(n: number): QueryResult {
    return new QueryResult(this.elements.slice(0, n), this.doc);
  }

  /**
   * Skip first N entities
   */
  skip(n: number): QueryResult {
    return new QueryResult(this.elements.slice(n), this.doc);
  }

  /**
   * Get first entity (or undefined)
   */
  first(): VirtualEntity | undefined {
    return this.elements[0];
  }

  /**
   * Get last entity (or undefined)
   */
  last(): VirtualEntity | undefined {
    return this.elements[this.elements.length - 1];
  }

  /**
   * Get entity at index (returns QueryResult for chaining)
   */
  eq(index: number): QueryResult {
    const entity = this.elements[index];
    return new QueryResult(entity ? [entity] : [], this.doc);
  }

  /**
   * Get entity by ID
   */
  byId(id: string): QueryResult {
    return new QueryResult(
      this.elements.filter(e => e.id === id),
      this.doc
    );
  }

  // ==========================================================================
  // SORTING
  // ==========================================================================

  /**
   * Sort by a key or comparator function
   */
  sortBy(
    key: keyof VirtualEntity | ((e: VirtualEntity) => number | string)
  ): QueryResult {
    const sorted = [...this.elements].sort((a, b) => {
      const aVal = typeof key === 'function' ? key(a) : a[key];
      const bVal = typeof key === 'function' ? key(b) : b[key];

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return aVal - bVal;
      }
      return String(aVal).localeCompare(String(bVal));
    });

    return new QueryResult(sorted, this.doc);
  }

  /**
   * Sort by confidence (descending - highest first)
   */
  sortByConfidence(): QueryResult {
    return new QueryResult(
      [...this.elements].sort((a, b) => b.meta.confidence - a.meta.confidence),
      this.doc
    );
  }

  /**
   * Sort by position (top to bottom, left to right)
   */
  sortByPosition(): QueryResult {
    return new QueryResult(
      [...this.elements].sort((a, b) => {
        const yDiff = a.bbox.ymin - b.bbox.ymin;
        if (Math.abs(yDiff) > 0.01) return yDiff;
        return a.bbox.xmin - b.bbox.xmin;
      }),
      this.doc
    );
  }

  // ==========================================================================
  // DATA ACCESS (jQuery-style .data())
  // ==========================================================================

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
  data(keyOrValues: string | Record<string, unknown>, value?: unknown): unknown | QueryResult {
    // GET mode
    if (typeof keyOrValues === 'string' && value === undefined) {
      const entity = this.elements[0];
      if (!entity) return undefined;
      // Check _data first, then fall back to meta
      if (entity._data && keyOrValues in entity._data) {
        return entity._data[keyOrValues];
      }
      if (keyOrValues in entity.meta) {
        return entity.meta[keyOrValues as keyof EntityMeta];
      }
      return undefined;
    }

    // SET mode
    const dataToSet: Record<string, unknown> =
      typeof keyOrValues === 'string' ? { [keyOrValues]: value } : keyOrValues;

    for (const entity of this.elements) {
      if (!entity._data) {
        entity._data = {};
      }
      Object.assign(entity._data, dataToSet);
    }

    return this;
  }

  /**
   * Get text content of first element
   */
  text(): string | undefined {
    return this.elements[0]?.text;
  }

  // ==========================================================================
  // MUTATIONS (jQuery-style .attr())
  // ==========================================================================

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
  attr(
    keyOrAttrs: string | Record<string, unknown>,
    value?: unknown
  ): unknown | QueryResult {
    // GET mode: single string key, no value
    if (typeof keyOrAttrs === 'string' && value === undefined) {
      return this.getAttr(keyOrAttrs);
    }

    // SET mode: either (key, value) or { key: value, ... }
    const attrs: Record<string, unknown> =
      typeof keyOrAttrs === 'string'
        ? { [keyOrAttrs]: value }
        : keyOrAttrs;

    return this.setAttrs(attrs);
  }

  /**
   * Get attribute value from first element
   */
  private getAttr(key: string): unknown {
    const entity = this.elements[0];
    if (!entity) return undefined;

    // Check meta first
    if (key in entity.meta) {
      return entity.meta[key as keyof EntityMeta];
    }

    // Then check entity fields
    if (key in entity) {
      return entity[key as keyof VirtualEntity];
    }

    return undefined;
  }

  /**
   * Set attributes on all selected entities
   */
  private setAttrs(attrs: Record<string, unknown>): QueryResult {
    const now = Date.now();

    for (const entity of this.elements) {
      for (const [key, newValue] of Object.entries(attrs)) {
        const oldValue = this.getEntityAttr(entity, key);

        // Skip if no change
        if (oldValue === newValue) continue;

        // Track the change
        this.mutationLog.push({
          entityId: entity.id,
          pageIndex: entity.pageIndex,
          field: key,
          oldValue,
          newValue,
          timestamp: now,
        });

        // Apply the mutation
        this.setEntityAttr(entity, key, newValue);
      }
    }

    // Increment doc version if there were changes
    if (this.mutationLog.length > 0) {
      (this.doc as { version: number }).version++;
    }

    return this;
  }

  /**
   * Get attribute from a specific entity
   */
  private getEntityAttr(entity: VirtualEntity, key: string): unknown {
    if (key in entity.meta) {
      return entity.meta[key as keyof EntityMeta];
    }
    if (key in entity) {
      return entity[key as keyof VirtualEntity];
    }
    return undefined;
  }

  /**
   * Set attribute on a specific entity
   */
  private setEntityAttr(entity: VirtualEntity, key: string, value: unknown): void {
    // Meta fields
    const metaFields = [
      'verified', 'verificationStatus', 'verifiedBy', 'verifiedAt',
      'confidence', 'wasCorrected', 'correctionType', 'source', 'processorType',
      'flagReason', 'flaggedBy', 'flaggedAt', 'highlight', 'selected',
    ];

    if (metaFields.includes(key)) {
      (entity.meta as Record<string, unknown>)[key] = value;
      return;
    }

    // Entity fields (only mutable ones)
    const mutableEntityFields = ['text', 'value', 'type'];
    if (mutableEntityFields.includes(key)) {
      (entity as unknown as Record<string, unknown>)[key] = value;
      return;
    }

    // Custom meta field (extensible)
    (entity.meta as Record<string, unknown>)[key] = value;
  }

  /**
   * Get all changes made to selected entities
   *
   * @example
   * const $tables = $$('.table').attr('verified', true);
   * console.log($tables.changes());
   * // [{ entityId: 't_1', field: 'verified', oldValue: false, newValue: true, ... }]
   */
  changes(): EntityChange[] {
    return [...this.mutationLog];
  }

  /**
   * Get mutation log for persistence/sync
   *
   * @example
   * const log = $$('.table').attr('verified', true).getMutationLog();
   * await syncChangesToDb(log);
   */
  getMutationLog(): MutationLog {
    return {
      docId: this.doc.id,
      docVersion: this.doc.version,
      changes: [...this.mutationLog],
      createdAt: Date.now(),
    };
  }

  /**
   * Clear mutation log (call after syncing to DB)
   */
  clearChanges(): QueryResult {
    this.mutationLog = [];
    return this;
  }

  /**
   * Check if there are unsaved changes
   */
  hasChanges(): boolean {
    return this.mutationLog.length > 0;
  }

  /**
   * Remove attributes from selected entities
   *
   * @example
   * $$('.table').removeAttr('flagReason');
   * $$('.flagged').removeAttr(['flagReason', 'flaggedBy', 'flaggedAt']);
   */
  removeAttr(key: string | string[]): QueryResult {
    const keys = Array.isArray(key) ? key : [key];
    const now = Date.now();

    for (const entity of this.elements) {
      for (const k of keys) {
        const oldValue = this.getEntityAttr(entity, k);
        if (oldValue === undefined) continue;

        this.mutationLog.push({
          entityId: entity.id,
          pageIndex: entity.pageIndex,
          field: k,
          oldValue,
          newValue: undefined,
          timestamp: now,
        });

        // Remove from meta (set to undefined)
        if (k in entity.meta) {
          delete (entity.meta as Record<string, unknown>)[k];
        }
      }
    }

    if (this.mutationLog.length > 0) {
      (this.doc as { version: number }).version++;
    }

    return this;
  }

  /**
   * Toggle a boolean attribute
   *
   * @example
   * $$('.table').toggleAttr('verified');
   * $$('.table').toggleAttr('highlight', true);  // Force to true
   */
  toggleAttr(key: string, force?: boolean): QueryResult {
    for (const entity of this.elements) {
      const current = Boolean(this.getEntityAttr(entity, key));
      const newValue = force !== undefined ? force : !current;
      this.setAttrs({ [key]: newValue });
    }
    return this;
  }

  /**
   * Get array of all text values
   */
  texts(): string[] {
    return this.elements.map(e => e.text);
  }

  /**
   * Get array of parsed numeric values
   */
  values(): (string | number | undefined)[] {
    return this.elements.map(e => e.value);
  }

  /**
   * Get array of entity IDs
   */
  ids(): string[] {
    return this.elements.map(e => e.id);
  }

  /**
   * Get array of entity types
   */
  types(): EntityType[] {
    return this.elements.map(e => e.type);
  }

  // ==========================================================================
  // ITERATION
  // ==========================================================================

  /**
   * Execute a function for each entity
   */
  each(fn: (entity: VirtualEntity, index: number) => void): QueryResult {
    this.elements.forEach(fn);
    return this;
  }

  /**
   * Map entities to a new array
   */
  map<T>(fn: (entity: VirtualEntity, index: number) => T): T[] {
    return this.elements.map(fn);
  }

  /**
   * Reduce entities to a single value
   */
  reduce<T>(fn: (acc: T, entity: VirtualEntity, index: number) => T, initial: T): T {
    return this.elements.reduce(fn, initial);
  }

  /**
   * Check if any entity matches predicate
   */
  some(predicate: (entity: VirtualEntity) => boolean): boolean {
    return this.elements.some(predicate);
  }

  /**
   * Check if all entities match predicate
   */
  every(predicate: (entity: VirtualEntity) => boolean): boolean {
    return this.elements.every(predicate);
  }

  /**
   * Find first entity matching predicate
   */
  find(predicate: (entity: VirtualEntity) => boolean): VirtualEntity | undefined {
    return this.elements.find(predicate);
  }

  // ==========================================================================
  // AGGREGATION & STATISTICS
  // ==========================================================================

  /**
   * Calculate statistics for the selection
   */
  stats(): QueryStats {
    const total = this.length;
    let verified = 0;
    let flagged = 0;
    let pending = 0;
    let confidenceSum = 0;

    for (const entity of this.elements) {
      confidenceSum += entity.meta.confidence;
      switch (entity.meta.verificationStatus) {
        case 'verified':
          verified++;
          break;
        case 'flagged':
          flagged++;
          break;
        case 'pending':
          pending++;
          break;
      }
    }

    return {
      total,
      verified,
      flagged,
      pending,
      score: total > 0 ? verified / total : 0,
      avgConfidence: total > 0 ? confidenceSum / total : 0,
    };
  }

  /**
   * Sum numeric values
   */
  sum(): number {
    return this.elements.reduce((acc, e) => {
      const val = typeof e.value === 'number' ? e.value : 0;
      return acc + val;
    }, 0);
  }

  /**
   * Average numeric values
   */
  avg(): number {
    const nums = this.elements
      .map(e => e.value)
      .filter((v): v is number => typeof v === 'number');
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }

  /**
   * Get minimum numeric value
   */
  min(): number | undefined {
    const nums = this.elements
      .map(e => e.value)
      .filter((v): v is number => typeof v === 'number');
    return nums.length > 0 ? Math.min(...nums) : undefined;
  }

  /**
   * Get maximum numeric value
   */
  max(): number | undefined {
    const nums = this.elements
      .map(e => e.value)
      .filter((v): v is number => typeof v === 'number');
    return nums.length > 0 ? Math.max(...nums) : undefined;
  }

  /**
   * Count total entities
   */
  count(): number {
    return this.length;
  }

  // ==========================================================================
  // GROUPING
  // ==========================================================================

  /**
   * Group entities by a key function
   */
  groupBy<K extends string | number>(
    keyFn: (entity: VirtualEntity) => K
  ): Map<K, QueryResult> {
    const groups = new Map<K, VirtualEntity[]>();

    for (const entity of this.elements) {
      const key = keyFn(entity);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entity);
    }

    const result = new Map<K, QueryResult>();
    for (const [key, entities] of groups) {
      result.set(key, new QueryResult(entities, this.doc));
    }

    return result;
  }

  /**
   * Group by page number (1-indexed)
   */
  groupByPage(): Map<number, QueryResult> {
    return this.groupBy(e => e.pageIndex + 1);
  }

  /**
   * Group by entity type
   */
  groupByType(): Map<EntityType, QueryResult> {
    return this.groupBy(e => e.type);
  }

  /**
   * Count entities by type
   */
  countByType(): Map<EntityType, number> {
    const counts = new Map<EntityType, number>();
    for (const entity of this.elements) {
      counts.set(entity.type, (counts.get(entity.type) || 0) + 1);
    }
    return counts;
  }

  /**
   * Count entities by page
   */
  countByPage(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const entity of this.elements) {
      const page = entity.pageIndex + 1;
      counts.set(page, (counts.get(page) || 0) + 1);
    }
    return counts;
  }

  // ==========================================================================
  // SERIALIZATION
  // ==========================================================================

  /**
   * Get raw entity array (copy)
   */
  toArray(): VirtualEntity[] {
    return [...this.elements];
  }

  /**
   * Get JSON string representation
   */
  json(): string {
    return JSON.stringify(this.elements);
  }

  // ==========================================================================
  // HTML RENDERING (jQuery-style .html() output)
  // ==========================================================================

  /**
   * Render entities to HTML string (like jQuery's .html())
   *
   * @example
   * $$('.table').html()           // Render tables as HTML
   * $$('*').onPage(1).html()      // Render all page 1 entities
   */
  html(options?: RenderOptions): string {
    return renderToHtml(this.elements, options);
  }

  /**
   * Render as HTML document with head/body
   */
  htmlDocument(options?: RenderOptions): string {
    const body = this.html(options);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OkraPDF Document</title>
  <style>${getDefaultStyles()}</style>
</head>
<body>
  <div class="okra-document">
    ${body}
  </div>
</body>
</html>`;
  }

  /**
   * Render grouped by page (like a document view)
   */
  htmlByPage(options?: RenderOptions): string {
    const byPage = this.groupByPage();
    const pages: string[] = [];

    for (const [pageNum, group] of byPage) {
      pages.push(`
        <div class="okra-page" data-page="${pageNum}">
          <div class="okra-page-header">Page ${pageNum}</div>
          <div class="okra-page-content">
            ${group.html(options)}
          </div>
        </div>
      `);
    }

    return pages.join('\n');
  }

  /**
   * Get the parent document
   */
  getDoc(): VirtualDoc {
    return this.doc;
  }

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
  async markdown(options?: {
    imageUrl?: string;
    model?: string;
    promptStyle?: 'table' | 'page' | 'json';
    apiEndpoint?: string;
    force?: boolean;
  }): Promise<string> {
    const entity = this.first();
    if (!entity) return '';

    const {
      imageUrl,
      model = 'qwen/qwen3-vl-235b-a22b-instruct',
      promptStyle = 'table',
      apiEndpoint = '/api/transform/entity-to-markdown',
      force = false,
    } = options || {};

    // Return cached result unless force refresh
    const cached = entity._data?.transformation;
    if (cached && !force) {
      return cached.markdown;
    }

    if (!imageUrl) {
      return entity.text || '';
    }

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl,
          model,
          promptStyle,
          entityType: entity.type,
        }),
      });

      if (!response.ok) {
        console.warn(`[QueryResult.markdown] API error: ${response.status}`);
        return entity.text || '';
      }

      const data = await response.json();

      if (data.success) {
        // Store full transformation result on entity
        const transformResult: TransformationResult = {
          success: true,
          markdown: data.markdown,
          model: data.model,
          tokens: data.tokens,
          timestamp: Date.now(),
          promptStyle,
        };

        if (!entity._data) entity._data = {};
        entity._data.transformation = transformResult;

        return data.markdown;
      }

      return entity.text || '';
    } catch (err) {
      console.warn('[QueryResult.markdown] Error:', err);
      return entity.text || '';
    }
  }
}

// ============================================================================
// HTML Rendering Types & Functions
// ============================================================================

export interface RenderOptions {
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

function getDefaultStyles(): string {
  return `
    .okra-document { font-family: system-ui, sans-serif; padding: 20px; }
    .okra-page { border: 1px solid #e0e0e0; margin-bottom: 20px; border-radius: 8px; overflow: hidden; }
    .okra-page-header { background: #f5f5f5; padding: 8px 16px; font-weight: 600; border-bottom: 1px solid #e0e0e0; }
    .okra-page-content { padding: 16px; }
    .okra-entity { margin: 8px 0; padding: 8px 12px; border-radius: 4px; border-left: 3px solid #ccc; background: #fafafa; }
    .okra-entity.type-table { border-left-color: #2196f3; background: #e3f2fd; }
    .okra-entity.type-currency { border-left-color: #4caf50; background: #e8f5e9; }
    .okra-entity.type-percentage { border-left-color: #ff9800; background: #fff3e0; }
    .okra-entity.type-date { border-left-color: #9c27b0; background: #f3e5f5; }
    .okra-entity.type-header { border-left-color: #607d8b; background: #eceff1; font-weight: 600; }
    .okra-entity.type-footnote { border-left-color: #795548; background: #efebe9; font-size: 0.9em; font-style: italic; }
    .okra-entity.type-figure { border-left-color: #e91e63; background: #fce4ec; }
    .okra-entity.status-verified { box-shadow: inset 0 0 0 1px #4caf50; }
    .okra-entity.status-flagged { box-shadow: inset 0 0 0 1px #f44336; }
    .okra-entity.status-pending { box-shadow: inset 0 0 0 1px #ff9800; }
    .okra-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.75em; margin-left: 8px; }
    .okra-badge.confidence { background: #e0e0e0; color: #333; }
    .okra-badge.confidence.high { background: #c8e6c9; color: #2e7d32; }
    .okra-badge.confidence.low { background: #ffcdd2; color: #c62828; }
    .okra-badge.status { text-transform: uppercase; font-weight: 600; }
    .okra-badge.status.verified { background: #4caf50; color: white; }
    .okra-badge.status.flagged { background: #f44336; color: white; }
    .okra-badge.status.pending { background: #ff9800; color: white; }
    .okra-type { color: #666; font-size: 0.8em; text-transform: uppercase; }
    .okra-text { margin-top: 4px; }
    .okra-value { font-family: monospace; background: #f5f5f5; padding: 2px 4px; border-radius: 2px; }
    .okra-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .okra-table th, .okra-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .okra-table th { background: #f5f5f5; font-weight: 600; }
    .okra-table tr:nth-child(even) { background: #fafafa; }
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseMarkdownTable(markdown: string): { headers: string[]; rows: string[][] } | null {
  const lines = markdown.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;

  const parseLine = (line: string): string[] =>
    line.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);

  const headers = parseLine(lines[0]);
  if (headers.length === 0) return null;

  // Skip separator line (line with ---)
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes('---')) continue;
    rows.push(parseLine(lines[i]));
  }

  return { headers, rows };
}

function renderTableAsHtml(markdown: string): string {
  const parsed = parseMarkdownTable(markdown);
  if (!parsed) return `<pre class="okra-markdown">${escapeHtml(markdown)}</pre>`;

  const { headers, rows } = parsed;
  const headerHtml = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
  const rowsHtml = rows
    .map(row => `<tr>${row.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('\n');

  return `<table class="okra-table">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}

function renderEntity(entity: VirtualEntity, options: RenderOptions = {}): string {
  const {
    includeMetadata = true,
    showConfidence = true,
    showStatus = true,
    renderTables = true,
    classPrefix = 'okra',
  } = options;

  const classes = [
    `${classPrefix}-entity`,
    `type-${entity.type}`,
    `status-${entity.meta.verificationStatus}`,
  ].join(' ');

  const dataAttrs = includeMetadata
    ? `data-id="${entity.id}" data-type="${entity.type}" data-page="${entity.pageIndex + 1}" data-confidence="${entity.meta.confidence}"`
    : '';

  // Confidence badge
  const confClass = entity.meta.confidence > 0.9 ? 'high' : entity.meta.confidence < 0.7 ? 'low' : '';
  const confidenceBadge = showConfidence
    ? `<span class="${classPrefix}-badge confidence ${confClass}">${(entity.meta.confidence * 100).toFixed(0)}%</span>`
    : '';

  // Status badge
  const statusBadge = showStatus
    ? `<span class="${classPrefix}-badge status ${entity.meta.verificationStatus}">${entity.meta.verificationStatus}</span>`
    : '';

  // Content rendering based on type
  let content: string;
  if (entity.type === 'table' && renderTables) {
    content = renderTableAsHtml(entity.text);
  } else {
    content = `<div class="${classPrefix}-text">${escapeHtml(entity.text)}</div>`;
  }

  // Value display
  const valueHtml = entity.value !== undefined
    ? `<span class="${classPrefix}-value">${entity.value}</span>`
    : '';

  return `
    <div class="${classes}" ${dataAttrs}>
      <div class="${classPrefix}-header">
        <span class="${classPrefix}-type">${entity.type}</span>
        ${confidenceBadge}
        ${statusBadge}
        ${valueHtml}
      </div>
      ${content}
    </div>
  `;
}

function renderToHtml(entities: VirtualEntity[], options: RenderOptions = {}): string {
  return entities.map(e => renderEntity(e, options)).join('\n');
}

// ============================================================================
// Selector Matching
// ============================================================================

function matchesSelector(entity: VirtualEntity, selector: string): boolean {
  // Universal selector
  if (selector === '*') return true;

  // Parse compound selector into parts: .table[confidence>0.9] → ['.table', '[confidence>0.9]']
  const parts = parseCompoundSelector(selector);
  if (parts.length === 0) return false;

  // All parts must match (AND logic)
  return parts.every(part => matchesSingleSelector(entity, part));
}

/**
 * Parse a compound selector into individual parts.
 * Follows jQuery/Sizzle tokenization pattern.
 *
 * Examples:
 *   ".table" → [".table"]
 *   ".table[confidence>0.9]" → [".table", "[confidence>0.9]"]
 *   "[a=1][b=2]" → ["[a=1]", "[b=2]"]
 *   ":contains(text)" → [":contains(text)"]
 *   ".table:contains(revenue)" → [".table", ":contains(revenue)"]
 *   "#id.class[attr]" → ["#id", ".class", "[attr]"]
 */
function parseCompoundSelector(selector: string): string[] {
  const parts: string[] = [];
  let i = 0;

  while (i < selector.length) {
    const char = selector[i];

    if (char === '.' || char === '#') {
      // Type selector (.class) or ID selector (#id)
      let part = char;
      i++;
      while (i < selector.length && /[\w-]/.test(selector[i])) {
        part += selector[i];
        i++;
      }
      if (part.length > 1) parts.push(part);
    } else if (char === '[') {
      // Attribute selector [attr=value]
      let part = char;
      i++;
      while (i < selector.length && selector[i] !== ']') {
        part += selector[i];
        i++;
      }
      if (i < selector.length) {
        part += selector[i]; // Include ]
        i++;
      }
      parts.push(part);
    } else if (char === ':') {
      // Pseudo-selector :contains(text), :first, etc.
      let part = char;
      i++;
      // Consume identifier
      while (i < selector.length && /[\w-]/.test(selector[i])) {
        part += selector[i];
        i++;
      }
      // Check for parentheses
      if (i < selector.length && selector[i] === '(') {
        part += selector[i];
        i++;
        let depth = 1;
        while (i < selector.length && depth > 0) {
          if (selector[i] === '(') depth++;
          if (selector[i] === ')') depth--;
          part += selector[i];
          i++;
        }
      }
      if (part.length > 1) parts.push(part);
    } else if (char === '*') {
      parts.push('*');
      i++;
    } else {
      // Skip whitespace or unknown chars
      i++;
    }
  }

  return parts;
}

/**
 * Match a single selector part against an entity.
 */
function matchesSingleSelector(entity: VirtualEntity, selector: string): boolean {
  // Universal selector
  if (selector === '*') return true;

  // Type selector: .currency, .table, .text
  if (selector.startsWith('.')) {
    return entity.type === selector.substring(1);
  }

  // Attribute selector: [verified=true], [confidence>0.9]
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const content = selector.slice(1, -1);

    // String operators: ^= (starts), $= (ends), *= (contains)
    const stringMatch = content.match(/^(\w+)([\^$*]?=)(.+)$/);
    if (stringMatch) {
      const [, key, op, rawValue] = stringMatch;
      const entityValue = String(getEntityValue(entity, key) ?? '');
      const targetValue = rawValue.replace(/^["']|["']$/g, ''); // Remove quotes

      switch (op) {
        case '=':
          return entityValue === targetValue;
        case '^=':
          return entityValue.startsWith(targetValue);
        case '$=':
          return entityValue.endsWith(targetValue);
        case '*=':
          return entityValue.includes(targetValue);
      }
    }

    // Comparison operators: !=, >, >=, <, <=
    const compMatch = content.match(/^(\w+)(>=?|<=?|!=)(.+)$/);
    if (compMatch) {
      const [, key, op, rawValue] = compMatch;
      const entityValue = getEntityValue(entity, key);
      const targetValue = parseValue(rawValue);

      switch (op) {
        case '!=':
          return String(entityValue) !== String(targetValue);
        case '>':
          return Number(entityValue) > Number(targetValue);
        case '>=':
          return Number(entityValue) >= Number(targetValue);
        case '<':
          return Number(entityValue) < Number(targetValue);
        case '<=':
          return Number(entityValue) <= Number(targetValue);
      }
    }

    // Presence check: [verified]
    const presenceMatch = content.match(/^(\w+)$/);
    if (presenceMatch) {
      const [, key] = presenceMatch;
      return getEntityValue(entity, key) !== undefined;
    }
  }

  // ID selector: #entity_123
  if (selector.startsWith('#')) {
    return entity.id === selector.substring(1);
  }

  // Pseudo-selector: :contains(text)
  if (selector.startsWith(':contains(') && selector.endsWith(')')) {
    const searchText = selector.slice(10, -1).replace(/^["']|["']$/g, '').toLowerCase();
    return entity.text.toLowerCase().includes(searchText);
  }

  // Pseudo-selector: :page(n) - filter by page number (1-indexed)
  // Supports: :page(5), :page(<=5), :page(>=3), :page(<10), :page(>2)
  if (selector.startsWith(':page(') && selector.endsWith(')')) {
    const content = selector.slice(6, -1);
    const page = entity.pageIndex + 1;

    // Check for comparison operators
    const compMatch = content.match(/^(<=?|>=?)(\d+)$/);
    if (compMatch) {
      const [, op, numStr] = compMatch;
      const targetPage = parseInt(numStr, 10);
      switch (op) {
        case '<=': return page <= targetPage;
        case '<': return page < targetPage;
        case '>=': return page >= targetPage;
        case '>': return page > targetPage;
      }
    }

    // Simple page number
    const pageNum = parseInt(content, 10);
    if (!isNaN(pageNum)) {
      return page === pageNum;
    }
  }

  // Pseudo-selector: :pages(start-end) - filter by page range (1-indexed, inclusive)
  if (selector.startsWith(':pages(') && selector.endsWith(')')) {
    const rangeStr = selector.slice(7, -1);
    const match = rangeStr.match(/^(\d+)-(\d+)$/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      const page = entity.pageIndex + 1;
      return page >= start && page <= end;
    }
  }

  return false;
}

function getEntityValue(entity: VirtualEntity, key: string): unknown {
  // Check meta first
  if (key in entity.meta) {
    return entity.meta[key as keyof EntityMeta];
  }
  // Then check entity properties
  if (key in entity) {
    return entity[key as keyof VirtualEntity];
  }
  return undefined;
}

function parseValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;

  const num = parseFloat(value);
  if (!isNaN(num)) return num;

  // Remove quotes if present
  return value.replace(/^["']|["']$/g, '');
}

// ============================================================================
// Query Engine Factory
// ============================================================================

export type QueryEngine = (selector?: Selector) => QueryResult;

/**
 * Create a query engine bound to a document
 *
 * @example
 * const $$ = createQueryEngine(doc);
 * $$('.currency').stats();
 * $$('[confidence>0.9]').texts();
 * $$('*').onPage(2).countByType();
 */
export function createQueryEngine(doc: VirtualDoc): QueryEngine {
  const allEntities = doc.pages.flatMap(page => page.entities);

  return (selector?: Selector): QueryResult => {
    if (!selector || selector === '*') {
      return new QueryResult(allEntities, doc);
    }

    if (typeof selector === 'function') {
      return new QueryResult(allEntities.filter(selector), doc);
    }

    // Handle OR combinator: ".table, .figure"
    // Split by comma, but be careful not to split inside brackets or parentheses
    const selectors = splitOrSelector(selector);

    if (selectors.length === 1) {
      // Single selector - may contain index pseudo-selectors
      const { baseSelector, indexFilter } = parseIndexPseudoSelector(selector);
      let entities = allEntities.filter(e => matchesSelector(e, baseSelector));
      entities = applyIndexFilter(entities, indexFilter);
      return new QueryResult(entities, doc);
    }

    // Multiple selectors (OR logic) - union of all matches
    const matchedIds = new Set<string>();
    const matched: VirtualEntity[] = [];

    for (const sel of selectors) {
      const trimmed = sel.trim();
      if (!trimmed) continue;

      // Each OR branch may have its own index filter
      const { baseSelector, indexFilter } = parseIndexPseudoSelector(trimmed);
      let branchMatches = allEntities.filter(e => matchesSelector(e, baseSelector));
      branchMatches = applyIndexFilter(branchMatches, indexFilter);

      for (const entity of branchMatches) {
        if (!matchedIds.has(entity.id)) {
          matchedIds.add(entity.id);
          matched.push(entity);
        }
      }
    }

    return new QueryResult(matched, doc);
  };
}

// ============================================================================
// Index Pseudo-Selector Handling
// ============================================================================

interface IndexFilter {
  type: 'first' | 'last' | 'eq' | 'gt' | 'lt' | 'even' | 'odd' | null;
  value?: number;
}

/**
 * Parse index pseudo-selectors from end of selector string.
 *
 * Examples:
 *   ".table:first" → { baseSelector: ".table", indexFilter: { type: "first" } }
 *   ".table:eq(2)" → { baseSelector: ".table", indexFilter: { type: "eq", value: 2 } }
 *   ".table:gt(1)" → { baseSelector: ".table", indexFilter: { type: "gt", value: 1 } }
 */
function parseIndexPseudoSelector(selector: string): { baseSelector: string; indexFilter: IndexFilter } {
  // Match index pseudo-selectors at the end
  const indexPatterns = [
    { regex: /:first$/, type: 'first' as const },
    { regex: /:last$/, type: 'last' as const },
    { regex: /:even$/, type: 'even' as const },
    { regex: /:odd$/, type: 'odd' as const },
    { regex: /:eq\((\d+)\)$/, type: 'eq' as const },
    { regex: /:gt\((\d+)\)$/, type: 'gt' as const },
    { regex: /:lt\((\d+)\)$/, type: 'lt' as const },
  ];

  for (const pattern of indexPatterns) {
    const match = selector.match(pattern.regex);
    if (match) {
      const baseSelector = selector.slice(0, match.index) || '*';
      const value = match[1] !== undefined ? parseInt(match[1], 10) : undefined;
      return {
        baseSelector: baseSelector.trim() || '*',
        indexFilter: { type: pattern.type, value },
      };
    }
  }

  return { baseSelector: selector, indexFilter: { type: null } };
}

/**
 * Apply index-based filter to entity array.
 */
function applyIndexFilter(entities: VirtualEntity[], filter: IndexFilter): VirtualEntity[] {
  if (filter.type === null) return entities;

  switch (filter.type) {
    case 'first':
      return entities.length > 0 ? [entities[0]] : [];
    case 'last':
      return entities.length > 0 ? [entities[entities.length - 1]] : [];
    case 'eq':
      return filter.value !== undefined && entities[filter.value]
        ? [entities[filter.value]]
        : [];
    case 'gt':
      return filter.value !== undefined
        ? entities.slice(filter.value + 1)
        : entities;
    case 'lt':
      return filter.value !== undefined
        ? entities.slice(0, filter.value)
        : entities;
    case 'even':
      return entities.filter((_, i) => i % 2 === 0);
    case 'odd':
      return entities.filter((_, i) => i % 2 === 1);
    default:
      return entities;
  }
}

/**
 * Split a selector string by comma (OR combinator), respecting brackets and parentheses.
 *
 * Examples:
 *   ".table, .figure" → [".table", ".figure"]
 *   ".table[a=1,2], .figure" → [".table[a=1,2]", ".figure"]  // comma inside brackets preserved
 *   ":contains(a, b), .table" → [":contains(a, b)", ".table"]  // comma inside parens preserved
 */
function splitOrSelector(selector: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;  // Track nesting depth for [] and ()

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];

    if (char === '[' || char === '(') {
      depth++;
      current += char;
    } else if (char === ']' || char === ')') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      // Found OR separator at top level
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last part
  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Query a specific page
 */
export function queryPage(doc: VirtualDoc, pageNumber: number): QueryResult {
  const page = doc.pages.find(p => p.pageNumber === pageNumber);
  return new QueryResult(page?.entities || [], doc);
}

/**
 * Query across multiple pages
 */
export function queryPages(doc: VirtualDoc, pageNumbers: number[]): QueryResult {
  const pageSet = new Set(pageNumbers);
  const entities = doc.pages
    .filter(p => pageSet.has(p.pageNumber))
    .flatMap(p => p.entities);
  return new QueryResult(entities, doc);
}

// ============================================================================
// Config-Based Query Execution (for CLI/API/Search consumers)
// ============================================================================

/**
 * Convert VirtualEntity to serializable QueryResultItem
 */
function toResultItem(entity: VirtualEntity): QueryResultItem {
  return {
    id: entity.id,
    type: entity.type,
    text: entity.text,
    value: entity.value,
    page: entity.pageIndex + 1,
    bbox: entity.bbox,
    confidence: entity.meta.confidence,
    status: entity.meta.verificationStatus,
    tableId: entity.tableId,
    position: entity.rowIndex !== undefined
      ? { row: entity.rowIndex, col: entity.colIndex ?? 0 }
      : undefined,
  };
}

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
export function executeQuery(doc: VirtualDoc, config: QueryConfig): QueryResponse {
  const startTime = Date.now();
  const $$ = createQueryEngine(doc);

  // Start with selector
  let result = $$(config.selector);

  // Apply page range filter
  if (config.pageRange) {
    const [start, end] = config.pageRange;
    result = result.filter(e => {
      const page = e.pageIndex + 1;
      return page >= start && page <= end;
    });
  }

  // Apply confidence filter
  if (config.minConfidence !== undefined) {
    result = result.filter(`[confidence>=${config.minConfidence}]`);
  }

  // Apply status filter
  if (config.status) {
    const statuses = Array.isArray(config.status) ? config.status : [config.status];
    result = result.filter(e => statuses.includes(e.meta.verificationStatus));
  }

  // Apply text search
  if (config.contains) {
    result = result.contains(config.contains);
  }

  // Apply regex pattern
  if (config.pattern) {
    result = result.matches(new RegExp(config.pattern, 'i'));
  }

  // Apply sorting
  if (config.sortBy) {
    switch (config.sortBy) {
      case 'confidence':
        result = result.sortByConfidence();
        break;
      case 'position':
        result = result.sortByPosition();
        break;
      case 'page':
        result = result.sortBy(e => e.pageIndex);
        break;
    }
  }

  // Get stats before limiting
  const stats = result.stats();
  const total = result.length;

  // Apply topK limit
  if (config.topK !== undefined && config.topK > 0) {
    result = result.take(config.topK);
  }

  // Convert to serializable items
  const items = result.toArray().map(toResultItem);

  return {
    query: config.selector,
    documentId: doc.id,
    total,
    returned: items.length,
    items,
    stats,
    duration: Date.now() - startTime,
  };
}

/**
 * Format query response for text output (like semtools search output)
 */
export function formatQueryResponse(response: QueryResponse, options?: {
  showStats?: boolean;
  maxTextLength?: number;
}): string {
  const { showStats = true, maxTextLength = 80 } = options ?? {};
  const lines: string[] = [];

  // Header
  lines.push(`Query: ${response.query}`);
  lines.push(`Document: ${response.documentId}`);
  lines.push(`Results: ${response.returned}/${response.total} (${response.duration}ms)`);
  lines.push('');

  // Results
  for (const item of response.items) {
    const text = item.text.length > maxTextLength
      ? item.text.substring(0, maxTextLength) + '...'
      : item.text;
    const textOneLine = text.replace(/\n/g, ' ');

    lines.push(`[${item.page}:${item.id}] ${item.type} (${(item.confidence * 100).toFixed(0)}%)`);
    lines.push(`  ${textOneLine}`);
    if (item.value !== undefined) {
      lines.push(`  value: ${item.value}`);
    }
    lines.push('');
  }

  // Stats
  if (showStats) {
    lines.push('---');
    lines.push(`Stats: ${response.stats.verified} verified, ${response.stats.flagged} flagged, ${response.stats.pending} pending`);
    lines.push(`Avg confidence: ${(response.stats.avgConfidence * 100).toFixed(1)}%`);
  }

  return lines.join('\n');
}
