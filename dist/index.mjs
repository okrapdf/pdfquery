// src/compiler.ts
var CURRENCY_PATTERN = /^[\$£€¥]?\s*-?[\d,]+\.?\d*\s*(?:万|亿|千)?$/;
var PERCENTAGE_PATTERN = /^-?\d+\.?\d*\s*%$/;
var DATE_PATTERN = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$|^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/;
var NUMBER_PATTERN = /^-?[\d,]+\.?\d*$/;
function detectEntityType(text, label) {
  const trimmed = text.trim();
  if (label) {
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.includes("total")) return "total";
    if (lowerLabel.includes("subtotal")) return "subtotal";
    if (lowerLabel.includes("date")) return "date";
  }
  if (CURRENCY_PATTERN.test(trimmed)) return "currency";
  if (PERCENTAGE_PATTERN.test(trimmed)) return "percentage";
  if (DATE_PATTERN.test(trimmed)) return "date";
  if (NUMBER_PATTERN.test(trimmed)) return "number";
  if (trimmed.length < 50 && !trimmed.includes("\n")) return "label";
  return "text";
}
function parseMarkdownTable(markdown) {
  const lines = markdown.split("\n").filter((line) => line.trim());
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\|?\s*[-:]+\s*\|/.test(line)) continue;
    if (line.startsWith("|") || line.includes("|")) {
      const cells = line.split("|").map((cell) => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (cells.length > 0) {
        rows.push({
          cells,
          isHeader: rows.length === 0
          // First row is header
        });
      }
    }
  }
  const columnCount = Math.max(...rows.map((r) => r.cells.length), 0);
  return { rows, columnCount };
}
var DocCompiler = class {
  options;
  tables = [];
  entities = [];
  extractedEntities = [];
  ocrBlocks = [];
  markdownBlocks = [];
  version = 1;
  constructor(options = {}) {
    this.options = {
      includeTables: options.includeTables ?? true,
      parseTableCells: options.parseTableCells ?? true,
      autoDetectTypes: options.autoDetectTypes ?? true,
      documentId: options.documentId ?? `doc_${Date.now()}`,
      fileName: options.fileName ?? "unknown",
      documentType: options.documentType ?? "document"
    };
  }
  // --------------------------------------------------------------------------
  // Data Input Methods
  // --------------------------------------------------------------------------
  /**
   * Add extracted tables from API response
   */
  addTables(tables) {
    this.tables.push(...tables);
    return this;
  }
  /**
   * Add extracted entities from API response
   */
  addEntities(entities) {
    this.entities.push(...entities);
    return this;
  }
  /**
   * Add extracted entities from /api/ocr/jobs/{id}/entities
   * Unified format for tables, figures, footnotes, summaries
   */
  addExtractedEntities(entities) {
    this.extractedEntities.push(...entities);
    return this;
  }
  /**
   * Add raw OCR text blocks
   */
  addOcrBlocks(blocks) {
    this.ocrBlocks.push(...blocks);
    return this;
  }
  /**
   * Add LLM vision markdown output
   */
  addMarkdownBlocks(blocks) {
    this.markdownBlocks.push(...blocks);
    return this;
  }
  /**
   * Add a single markdown page (for direct markdown input)
   */
  addMarkdownPage(markdown, pageNumber) {
    this.tables.push({
      id: `synthetic_${pageNumber}_${Date.now()}`,
      page_number: pageNumber,
      markdown,
      bbox: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
      confidence: 1,
      verification_status: "pending",
      verified_by: null,
      verified_at: null
    });
    return this;
  }
  /**
   * Reset compiler state for reuse
   */
  reset() {
    this.tables = [];
    this.entities = [];
    this.extractedEntities = [];
    this.ocrBlocks = [];
    this.markdownBlocks = [];
    this.version++;
    return this;
  }
  // --------------------------------------------------------------------------
  // Compilation
  // --------------------------------------------------------------------------
  /**
   * Compile all added data into a VirtualDoc
   */
  compile() {
    const now = Date.now();
    const pageMap = /* @__PURE__ */ new Map();
    const allPageNumbers = /* @__PURE__ */ new Set();
    this.tables.forEach((t) => allPageNumbers.add(t.page_number));
    this.entities.forEach((e) => allPageNumbers.add(e.page_number));
    this.extractedEntities.forEach((e) => allPageNumbers.add(e.page));
    this.ocrBlocks.forEach((o) => allPageNumbers.add(o.page));
    this.markdownBlocks.forEach((m) => allPageNumbers.add(m.page));
    for (const pageNum of allPageNumbers) {
      pageMap.set(pageNum, {
        tables: [],
        entities: [],
        extractedEntities: [],
        ocrBlocks: [],
        markdownBlocks: []
      });
    }
    for (const table of this.tables) {
      pageMap.get(table.page_number).tables.push(table);
    }
    for (const entity of this.entities) {
      pageMap.get(entity.page_number).entities.push(entity);
    }
    for (const extracted of this.extractedEntities) {
      pageMap.get(extracted.page).extractedEntities.push(extracted);
    }
    for (const ocr of this.ocrBlocks) {
      pageMap.get(ocr.page).ocrBlocks.push(ocr);
    }
    for (const md of this.markdownBlocks) {
      pageMap.get(md.page).markdownBlocks.push(md);
    }
    const pages = [];
    const sortedPageNumbers = Array.from(allPageNumbers).sort((a, b) => a - b);
    for (const pageNum of sortedPageNumbers) {
      const pageData = pageMap.get(pageNum);
      const page = this.buildPage(
        pageNum,
        pageData.tables,
        pageData.entities,
        pageData.extractedEntities,
        pageData.ocrBlocks,
        pageData.markdownBlocks
      );
      pages.push(page);
    }
    let totalEntities = 0;
    let verifiedCount = 0;
    let flaggedCount = 0;
    let pendingCount = 0;
    for (const page of pages) {
      totalEntities += page.meta.totalEntities;
      verifiedCount += page.meta.verifiedCount;
      flaggedCount += page.meta.flaggedCount;
      pendingCount += page.meta.pendingCount;
    }
    const meta = {
      fileName: this.options.fileName,
      documentType: this.options.documentType,
      totalPages: pages.length,
      totalEntities,
      verifiedCount,
      flaggedCount,
      pendingCount,
      verificationScore: totalEntities > 0 ? verifiedCount / totalEntities : 0,
      createdAt: now,
      lastModified: now
    };
    return {
      id: this.options.documentId,
      version: this.version,
      pages,
      meta
    };
  }
  // --------------------------------------------------------------------------
  // Page Building
  // --------------------------------------------------------------------------
  buildPage(pageNumber, tables, entities, extractedEntities = [], ocrBlocks = [], markdownBlocks = []) {
    const pageIndex = pageNumber - 1;
    const virtualEntities = [];
    if (this.options.includeTables) {
      for (const table of tables) {
        const tableEntity = this.tableToEntity(table, pageIndex);
        virtualEntities.push(tableEntity);
        if (this.options.parseTableCells && table.markdown) {
          const cellEntities = this.parseTableCells(table, pageIndex);
          virtualEntities.push(...cellEntities);
        }
      }
    }
    for (const entity of entities) {
      virtualEntities.push(this.sourceEntityToVirtual(entity, pageIndex));
    }
    for (const extracted of extractedEntities) {
      virtualEntities.push(this.extractedEntityToVirtual(extracted, pageIndex));
    }
    for (const ocr of ocrBlocks) {
      virtualEntities.push(this.ocrBlockToVirtual(ocr, pageIndex));
    }
    for (const md of markdownBlocks) {
      virtualEntities.push(this.markdownBlockToVirtual(md, pageIndex));
    }
    virtualEntities.sort((a, b) => a.bbox.ymin - b.bbox.ymin);
    const meta = this.calculatePageMeta(virtualEntities);
    const markdown = markdownBlocks.length > 0 ? markdownBlocks.map((m) => m.content).join("\n\n") : void 0;
    return {
      id: `p_${pageIndex}`,
      pageIndex,
      pageNumber,
      entities: virtualEntities,
      meta,
      markdown
    };
  }
  // --------------------------------------------------------------------------
  // Entity Conversion
  // --------------------------------------------------------------------------
  tableToEntity(table, pageIndex) {
    const status = table.verification_status || "pending";
    return {
      id: table.id,
      type: "table",
      text: table.markdown,
      bbox: {
        xmin: table.bbox.xmin,
        ymin: table.bbox.ymin,
        xmax: table.bbox.xmax,
        ymax: table.bbox.ymax
      },
      meta: this.buildMeta({
        confidence: table.confidence ?? 0,
        verificationStatus: status,
        verified: status === "verified",
        verifiedBy: table.verified_by ?? void 0,
        verifiedAt: table.verified_at ? new Date(table.verified_at).getTime() : void 0,
        wasCorrected: table.was_corrected ?? false,
        source: "ocr"
      }),
      pageIndex
    };
  }
  parseTableCells(table, pageIndex) {
    const entities = [];
    const parsed = parseMarkdownTable(table.markdown);
    if (parsed.rows.length === 0) return entities;
    const { xmin, ymin, xmax, ymax } = table.bbox;
    const tableWidth = xmax - xmin;
    const tableHeight = ymax - ymin;
    const rowHeight = tableHeight / parsed.rows.length;
    const colWidth = parsed.columnCount > 0 ? tableWidth / parsed.columnCount : tableWidth;
    for (let rowIdx = 0; rowIdx < parsed.rows.length; rowIdx++) {
      const row = parsed.rows[rowIdx];
      for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
        const cellText = row.cells[colIdx];
        if (!cellText.trim()) continue;
        const cellBbox = {
          xmin: xmin + colIdx * colWidth,
          ymin: ymin + rowIdx * rowHeight,
          xmax: xmin + (colIdx + 1) * colWidth,
          ymax: ymin + (rowIdx + 1) * rowHeight
        };
        const entityType = row.isHeader ? "header" : this.options.autoDetectTypes ? detectEntityType(cellText) : "table_cell";
        entities.push({
          id: `${table.id}_r${rowIdx}_c${colIdx}`,
          type: entityType,
          text: cellText,
          value: this.parseValue(cellText, entityType),
          bbox: cellBbox,
          meta: this.buildMeta({
            confidence: table.confidence ?? 0,
            verificationStatus: table.verification_status || "pending",
            verified: table.verification_status === "verified",
            wasCorrected: false,
            source: "ocr"
          }),
          pageIndex,
          tableId: table.id,
          rowIndex: rowIdx,
          colIndex: colIdx
        });
      }
    }
    return entities;
  }
  sourceEntityToVirtual(entity, pageIndex) {
    const status = entity.verification_status || "pending";
    const entityType = this.options.autoDetectTypes ? detectEntityType(entity.suggested_value, entity.field_label) : "text";
    const bbox = {
      xmin: entity.bounding_box.x,
      ymin: entity.bounding_box.y,
      xmax: entity.bounding_box.x + entity.bounding_box.width,
      ymax: entity.bounding_box.y + entity.bounding_box.height
    };
    return {
      id: entity.id,
      type: entityType,
      text: entity.verified_value || entity.suggested_value,
      value: entity.suggested_value_numeric ?? void 0,
      bbox,
      meta: this.buildMeta({
        confidence: entity.confidence,
        verificationStatus: status,
        verified: status === "verified",
        verifiedAt: entity.verified_at ? new Date(entity.verified_at).getTime() : void 0,
        wasCorrected: entity.was_corrected,
        flagReason: entity.flag_reason ?? void 0,
        flaggedAt: entity.flagged_at ? new Date(entity.flagged_at).getTime() : void 0,
        source: "ocr"
      }),
      pageIndex,
      rowIndex: entity.row_index ?? void 0
    };
  }
  /**
   * Convert unified extracted entity (table, figure, footnote, summary) to VirtualEntity
   */
  extractedEntityToVirtual(entity, pageIndex) {
    const status = entity.verification_status || "pending";
    const typeMap = {
      table: "table",
      figure: "figure",
      footnote: "footnote",
      summary: "text",
      signature: "text"
      // signatures are treated as text entities
    };
    const entityType = typeMap[entity.type] || entity.type || "unknown";
    const bbox = {
      xmin: entity.bbox.x,
      ymin: entity.bbox.y,
      xmax: entity.bbox.x + entity.bbox.width,
      ymax: entity.bbox.y + entity.bbox.height
    };
    let text = entity.title;
    if (entity.caption) {
      text = `${entity.title}
${entity.caption}`;
    }
    return {
      id: entity.id,
      type: entityType,
      text,
      bbox,
      meta: this.buildMeta({
        confidence: entity.confidence ?? 1,
        verificationStatus: status,
        verified: status === "verified",
        source: "ocr"
      }),
      pageIndex
    };
  }
  /**
   * Convert OCR block to VirtualEntity
   */
  ocrBlockToVirtual(ocr, pageIndex) {
    const status = ocr.verification_status || "pending";
    const bbox = {
      xmin: ocr.bbox.x,
      ymin: ocr.bbox.y,
      xmax: ocr.bbox.x + ocr.bbox.width,
      ymax: ocr.bbox.y + ocr.bbox.height
    };
    return {
      id: ocr.id,
      type: "ocr",
      text: ocr.text,
      bbox,
      meta: this.buildMeta({
        confidence: ocr.confidence,
        verificationStatus: status,
        verified: status === "verified",
        source: "ocr"
      }),
      pageIndex
    };
  }
  /**
   * Convert LLM vision markdown output to VirtualEntity
   */
  markdownBlockToVirtual(md, pageIndex) {
    const status = md.verification_status || "pending";
    const bbox = {
      xmin: 0,
      ymin: 0,
      xmax: 1,
      ymax: 1
    };
    return {
      id: md.id,
      type: "markdown",
      text: md.content,
      bbox,
      meta: this.buildMeta({
        confidence: md.confidence ?? 1,
        verificationStatus: status,
        verified: status === "verified",
        source: "ai_correction",
        processorType: md.model
      }),
      pageIndex
    };
  }
  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  buildMeta(partial) {
    return {
      verified: partial.verified ?? false,
      verificationStatus: partial.verificationStatus ?? "pending",
      verifiedBy: partial.verifiedBy,
      verifiedAt: partial.verifiedAt,
      confidence: partial.confidence ?? 0,
      wasCorrected: partial.wasCorrected ?? false,
      correctionType: partial.correctionType,
      source: partial.source ?? "system",
      processorType: partial.processorType,
      flagReason: partial.flagReason,
      flaggedBy: partial.flaggedBy,
      flaggedAt: partial.flaggedAt
    };
  }
  parseValue(text, type) {
    if (type === "currency" || type === "number") {
      const cleaned = text.replace(/[^\d.-]/g, "");
      const num = parseFloat(cleaned);
      return isNaN(num) ? void 0 : num;
    }
    if (type === "percentage") {
      const cleaned = text.replace(/[^\d.-]/g, "");
      const num = parseFloat(cleaned);
      return isNaN(num) ? void 0 : num / 100;
    }
    return void 0;
  }
  calculatePageMeta(entities) {
    const total = entities.length;
    let verified = 0;
    let flagged = 0;
    let pending = 0;
    let confidenceSum = 0;
    for (const entity of entities) {
      confidenceSum += entity.meta.confidence;
      switch (entity.meta.verificationStatus) {
        case "verified":
          verified++;
          break;
        case "flagged":
          flagged++;
          break;
        case "pending":
          pending++;
          break;
      }
    }
    return {
      totalEntities: total,
      verifiedCount: verified,
      flaggedCount: flagged,
      pendingCount: pending,
      avgConfidence: total > 0 ? confidenceSum / total : 0,
      verificationScore: total > 0 ? verified / total : 0
    };
  }
};
function createCompiler(options) {
  return new DocCompiler(options);
}
function compileDocument(tables, entities, options) {
  return new DocCompiler(options).addTables(tables).addEntities(entities).compile();
}

// src/query.ts
var QueryResult = class _QueryResult {
  elements;
  length;
  doc;
  mutationLog = [];
  constructor(entities, doc) {
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
  filter(selector) {
    let filtered;
    if (typeof selector === "function") {
      filtered = this.elements.filter(selector);
    } else if (typeof selector === "string") {
      filtered = this.elements.filter((e) => matchesSelector(e, selector));
    } else {
      filtered = this.elements;
    }
    return new _QueryResult(filtered, this.doc);
  }
  /**
   * Exclude entities matching the selector
   */
  not(selector) {
    let filtered;
    if (typeof selector === "function") {
      filtered = this.elements.filter((e) => !selector(e));
    } else if (typeof selector === "string") {
      filtered = this.elements.filter((e) => !matchesSelector(e, selector));
    } else {
      filtered = this.elements;
    }
    return new _QueryResult(filtered, this.doc);
  }
  /**
   * Find entities that contain specific text (case-insensitive)
   */
  contains(text) {
    const lower = text.toLowerCase();
    return new _QueryResult(
      this.elements.filter((e) => e.text && e.text.toLowerCase().includes(lower)),
      this.doc
    );
  }
  /**
   * Find entities matching a regex pattern
   */
  matches(pattern) {
    return new _QueryResult(
      this.elements.filter((e) => e.text && pattern.test(e.text)),
      this.doc
    );
  }
  /**
   * Get entities on a specific page (1-indexed)
   */
  onPage(pageNumber) {
    const pageIndex = pageNumber - 1;
    return new _QueryResult(
      this.elements.filter((e) => e.pageIndex === pageIndex),
      this.doc
    );
  }
  /**
   * Get entities within a specific table
   */
  inTable(tableId) {
    return new _QueryResult(
      this.elements.filter((e) => e.tableId === tableId),
      this.doc
    );
  }
  /**
   * Get first N entities
   */
  take(n) {
    return new _QueryResult(this.elements.slice(0, n), this.doc);
  }
  /**
   * Skip first N entities
   */
  skip(n) {
    return new _QueryResult(this.elements.slice(n), this.doc);
  }
  /**
   * Get first entity (or undefined)
   */
  first() {
    return this.elements[0];
  }
  /**
   * Get last entity (or undefined)
   */
  last() {
    return this.elements[this.elements.length - 1];
  }
  /**
   * Get entity at index (returns QueryResult for chaining)
   */
  eq(index) {
    const entity = this.elements[index];
    return new _QueryResult(entity ? [entity] : [], this.doc);
  }
  /**
   * Get entity by ID
   */
  byId(id) {
    return new _QueryResult(
      this.elements.filter((e) => e.id === id),
      this.doc
    );
  }
  // ==========================================================================
  // SORTING
  // ==========================================================================
  /**
   * Sort by a key or comparator function
   */
  sortBy(key) {
    const sorted = [...this.elements].sort((a, b) => {
      const aVal = typeof key === "function" ? key(a) : a[key];
      const bVal = typeof key === "function" ? key(b) : b[key];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return aVal - bVal;
      }
      return String(aVal).localeCompare(String(bVal));
    });
    return new _QueryResult(sorted, this.doc);
  }
  /**
   * Sort by confidence (descending - highest first)
   */
  sortByConfidence() {
    return new _QueryResult(
      [...this.elements].sort((a, b) => b.meta.confidence - a.meta.confidence),
      this.doc
    );
  }
  /**
   * Sort by position (top to bottom, left to right)
   */
  sortByPosition() {
    return new _QueryResult(
      [...this.elements].sort((a, b) => {
        const yDiff = a.bbox.ymin - b.bbox.ymin;
        if (Math.abs(yDiff) > 0.01) return yDiff;
        return a.bbox.xmin - b.bbox.xmin;
      }),
      this.doc
    );
  }
  data(keyOrValues, value) {
    if (typeof keyOrValues === "string" && value === void 0) {
      const entity = this.elements[0];
      if (!entity) return void 0;
      if (entity._data && keyOrValues in entity._data) {
        return entity._data[keyOrValues];
      }
      if (keyOrValues in entity.meta) {
        return entity.meta[keyOrValues];
      }
      return void 0;
    }
    const dataToSet = typeof keyOrValues === "string" ? { [keyOrValues]: value } : keyOrValues;
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
  text() {
    return this.elements[0]?.text;
  }
  attr(keyOrAttrs, value) {
    if (typeof keyOrAttrs === "string" && value === void 0) {
      return this.getAttr(keyOrAttrs);
    }
    const attrs = typeof keyOrAttrs === "string" ? { [keyOrAttrs]: value } : keyOrAttrs;
    return this.setAttrs(attrs);
  }
  /**
   * Get attribute value from first element
   */
  getAttr(key) {
    const entity = this.elements[0];
    if (!entity) return void 0;
    if (key in entity.meta) {
      return entity.meta[key];
    }
    if (key in entity) {
      return entity[key];
    }
    return void 0;
  }
  /**
   * Set attributes on all selected entities
   */
  setAttrs(attrs) {
    const now = Date.now();
    for (const entity of this.elements) {
      for (const [key, newValue] of Object.entries(attrs)) {
        const oldValue = this.getEntityAttr(entity, key);
        if (oldValue === newValue) continue;
        this.mutationLog.push({
          entityId: entity.id,
          pageIndex: entity.pageIndex,
          field: key,
          oldValue,
          newValue,
          timestamp: now
        });
        this.setEntityAttr(entity, key, newValue);
      }
    }
    if (this.mutationLog.length > 0) {
      this.doc.version++;
    }
    return this;
  }
  /**
   * Get attribute from a specific entity
   */
  getEntityAttr(entity, key) {
    if (key in entity.meta) {
      return entity.meta[key];
    }
    if (key in entity) {
      return entity[key];
    }
    return void 0;
  }
  /**
   * Set attribute on a specific entity
   */
  setEntityAttr(entity, key, value) {
    const metaFields = [
      "verified",
      "verificationStatus",
      "verifiedBy",
      "verifiedAt",
      "confidence",
      "wasCorrected",
      "correctionType",
      "source",
      "processorType",
      "flagReason",
      "flaggedBy",
      "flaggedAt",
      "highlight",
      "selected"
    ];
    if (metaFields.includes(key)) {
      entity.meta[key] = value;
      return;
    }
    const mutableEntityFields = ["text", "value", "type"];
    if (mutableEntityFields.includes(key)) {
      entity[key] = value;
      return;
    }
    entity.meta[key] = value;
  }
  /**
   * Get all changes made to selected entities
   *
   * @example
   * const $tables = $$('.table').attr('verified', true);
   * console.log($tables.changes());
   * // [{ entityId: 't_1', field: 'verified', oldValue: false, newValue: true, ... }]
   */
  changes() {
    return [...this.mutationLog];
  }
  /**
   * Get mutation log for persistence/sync
   *
   * @example
   * const log = $$('.table').attr('verified', true).getMutationLog();
   * await syncChangesToDb(log);
   */
  getMutationLog() {
    return {
      docId: this.doc.id,
      docVersion: this.doc.version,
      changes: [...this.mutationLog],
      createdAt: Date.now()
    };
  }
  /**
   * Clear mutation log (call after syncing to DB)
   */
  clearChanges() {
    this.mutationLog = [];
    return this;
  }
  /**
   * Check if there are unsaved changes
   */
  hasChanges() {
    return this.mutationLog.length > 0;
  }
  /**
   * Remove attributes from selected entities
   *
   * @example
   * $$('.table').removeAttr('flagReason');
   * $$('.flagged').removeAttr(['flagReason', 'flaggedBy', 'flaggedAt']);
   */
  removeAttr(key) {
    const keys = Array.isArray(key) ? key : [key];
    const now = Date.now();
    for (const entity of this.elements) {
      for (const k of keys) {
        const oldValue = this.getEntityAttr(entity, k);
        if (oldValue === void 0) continue;
        this.mutationLog.push({
          entityId: entity.id,
          pageIndex: entity.pageIndex,
          field: k,
          oldValue,
          newValue: void 0,
          timestamp: now
        });
        if (k in entity.meta) {
          delete entity.meta[k];
        }
      }
    }
    if (this.mutationLog.length > 0) {
      this.doc.version++;
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
  toggleAttr(key, force) {
    for (const entity of this.elements) {
      const current = Boolean(this.getEntityAttr(entity, key));
      const newValue = force !== void 0 ? force : !current;
      this.setAttrs({ [key]: newValue });
    }
    return this;
  }
  /**
   * Get array of all text values
   */
  texts() {
    return this.elements.map((e) => e.text);
  }
  /**
   * Get array of parsed numeric values
   */
  values() {
    return this.elements.map((e) => e.value);
  }
  /**
   * Get array of entity IDs
   */
  ids() {
    return this.elements.map((e) => e.id);
  }
  /**
   * Get array of entity types
   */
  types() {
    return this.elements.map((e) => e.type);
  }
  // ==========================================================================
  // ITERATION
  // ==========================================================================
  /**
   * Execute a function for each entity
   */
  each(fn) {
    this.elements.forEach(fn);
    return this;
  }
  /**
   * Map entities to a new array
   */
  map(fn) {
    return this.elements.map(fn);
  }
  /**
   * Reduce entities to a single value
   */
  reduce(fn, initial) {
    return this.elements.reduce(fn, initial);
  }
  /**
   * Check if any entity matches predicate
   */
  some(predicate) {
    return this.elements.some(predicate);
  }
  /**
   * Check if all entities match predicate
   */
  every(predicate) {
    return this.elements.every(predicate);
  }
  /**
   * Find first entity matching predicate
   */
  find(predicate) {
    return this.elements.find(predicate);
  }
  // ==========================================================================
  // AGGREGATION & STATISTICS
  // ==========================================================================
  /**
   * Calculate statistics for the selection
   */
  stats() {
    const total = this.length;
    let verified = 0;
    let flagged = 0;
    let pending = 0;
    let confidenceSum = 0;
    for (const entity of this.elements) {
      confidenceSum += entity.meta.confidence;
      switch (entity.meta.verificationStatus) {
        case "verified":
          verified++;
          break;
        case "flagged":
          flagged++;
          break;
        case "pending":
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
      avgConfidence: total > 0 ? confidenceSum / total : 0
    };
  }
  /**
   * Sum numeric values
   */
  sum() {
    return this.elements.reduce((acc, e) => {
      const val = typeof e.value === "number" ? e.value : 0;
      return acc + val;
    }, 0);
  }
  /**
   * Average numeric values
   */
  avg() {
    const nums = this.elements.map((e) => e.value).filter((v) => typeof v === "number");
    return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }
  /**
   * Get minimum numeric value
   */
  min() {
    const nums = this.elements.map((e) => e.value).filter((v) => typeof v === "number");
    return nums.length > 0 ? Math.min(...nums) : void 0;
  }
  /**
   * Get maximum numeric value
   */
  max() {
    const nums = this.elements.map((e) => e.value).filter((v) => typeof v === "number");
    return nums.length > 0 ? Math.max(...nums) : void 0;
  }
  /**
   * Count total entities
   */
  count() {
    return this.length;
  }
  // ==========================================================================
  // GROUPING
  // ==========================================================================
  /**
   * Group entities by a key function
   */
  groupBy(keyFn) {
    const groups = /* @__PURE__ */ new Map();
    for (const entity of this.elements) {
      const key = keyFn(entity);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entity);
    }
    const result = /* @__PURE__ */ new Map();
    for (const [key, entities] of groups) {
      result.set(key, new _QueryResult(entities, this.doc));
    }
    return result;
  }
  /**
   * Group by page number (1-indexed)
   */
  groupByPage() {
    return this.groupBy((e) => e.pageIndex + 1);
  }
  /**
   * Group by entity type
   */
  groupByType() {
    return this.groupBy((e) => e.type);
  }
  /**
   * Count entities by type
   */
  countByType() {
    const counts = /* @__PURE__ */ new Map();
    for (const entity of this.elements) {
      counts.set(entity.type, (counts.get(entity.type) || 0) + 1);
    }
    return counts;
  }
  /**
   * Count entities by page
   */
  countByPage() {
    const counts = /* @__PURE__ */ new Map();
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
  toArray() {
    return [...this.elements];
  }
  /**
   * Get JSON string representation
   */
  json() {
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
  html(options) {
    return renderToHtml(this.elements, options);
  }
  /**
   * Render as HTML document with head/body
   */
  htmlDocument(options) {
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
  htmlByPage(options) {
    const byPage = this.groupByPage();
    const pages = [];
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
    return pages.join("\n");
  }
  /**
   * Get the parent document
   */
  getDoc() {
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
  async markdown(options) {
    const entity = this.first();
    if (!entity) return "";
    const {
      imageUrl,
      model = "qwen/qwen3-vl-235b-a22b-instruct",
      promptStyle = "table",
      apiEndpoint = "/api/transform/entity-to-markdown",
      force = false
    } = options || {};
    const cached = entity._data?.transformation;
    if (cached && !force) {
      return cached.markdown;
    }
    if (!imageUrl) {
      return entity.text || "";
    }
    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl,
          model,
          promptStyle,
          entityType: entity.type
        })
      });
      if (!response.ok) {
        console.warn(`[QueryResult.markdown] API error: ${response.status}`);
        return entity.text || "";
      }
      const data = await response.json();
      if (data.success) {
        const transformResult = {
          success: true,
          markdown: data.markdown,
          model: data.model,
          tokens: data.tokens,
          timestamp: Date.now(),
          promptStyle
        };
        if (!entity._data) entity._data = {};
        entity._data.transformation = transformResult;
        return data.markdown;
      }
      return entity.text || "";
    } catch (err) {
      console.warn("[QueryResult.markdown] Error:", err);
      return entity.text || "";
    }
  }
};
function getDefaultStyles() {
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
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function parseMarkdownTable2(markdown) {
  const lines = markdown.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null;
  const parseLine = (line) => line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
  const headers = parseLine(lines[0]);
  if (headers.length === 0) return null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].includes("---")) continue;
    rows.push(parseLine(lines[i]));
  }
  return { headers, rows };
}
function renderTableAsHtml(markdown) {
  const parsed = parseMarkdownTable2(markdown);
  if (!parsed) return `<pre class="okra-markdown">${escapeHtml(markdown)}</pre>`;
  const { headers, rows } = parsed;
  const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const rowsHtml = rows.map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("\n");
  return `<table class="okra-table">
    <thead><tr>${headerHtml}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>`;
}
function renderEntity(entity, options = {}) {
  const {
    includeMetadata = true,
    showConfidence = true,
    showStatus = true,
    renderTables = true,
    classPrefix = "okra"
  } = options;
  const classes = [
    `${classPrefix}-entity`,
    `type-${entity.type}`,
    `status-${entity.meta.verificationStatus}`
  ].join(" ");
  const dataAttrs = includeMetadata ? `data-id="${entity.id}" data-type="${entity.type}" data-page="${entity.pageIndex + 1}" data-confidence="${entity.meta.confidence}"` : "";
  const confClass = entity.meta.confidence > 0.9 ? "high" : entity.meta.confidence < 0.7 ? "low" : "";
  const confidenceBadge = showConfidence ? `<span class="${classPrefix}-badge confidence ${confClass}">${(entity.meta.confidence * 100).toFixed(0)}%</span>` : "";
  const statusBadge = showStatus ? `<span class="${classPrefix}-badge status ${entity.meta.verificationStatus}">${entity.meta.verificationStatus}</span>` : "";
  let content;
  if (entity.type === "table" && renderTables) {
    content = renderTableAsHtml(entity.text);
  } else {
    content = `<div class="${classPrefix}-text">${escapeHtml(entity.text)}</div>`;
  }
  const valueHtml = entity.value !== void 0 ? `<span class="${classPrefix}-value">${entity.value}</span>` : "";
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
function renderToHtml(entities, options = {}) {
  return entities.map((e) => renderEntity(e, options)).join("\n");
}
function matchesSelector(entity, selector) {
  if (selector === "*") return true;
  const parts = parseCompoundSelector(selector);
  if (parts.length === 0) return false;
  return parts.every((part) => matchesSingleSelector(entity, part));
}
function parseCompoundSelector(selector) {
  const parts = [];
  let i = 0;
  while (i < selector.length) {
    const char = selector[i];
    if (char === "." || char === "#") {
      let part = char;
      i++;
      while (i < selector.length && /[\w-]/.test(selector[i])) {
        part += selector[i];
        i++;
      }
      if (part.length > 1) parts.push(part);
    } else if (char === "[") {
      let part = char;
      i++;
      while (i < selector.length && selector[i] !== "]") {
        part += selector[i];
        i++;
      }
      if (i < selector.length) {
        part += selector[i];
        i++;
      }
      parts.push(part);
    } else if (char === ":") {
      let part = char;
      i++;
      while (i < selector.length && /[\w-]/.test(selector[i])) {
        part += selector[i];
        i++;
      }
      if (i < selector.length && selector[i] === "(") {
        part += selector[i];
        i++;
        let depth = 1;
        while (i < selector.length && depth > 0) {
          if (selector[i] === "(") depth++;
          if (selector[i] === ")") depth--;
          part += selector[i];
          i++;
        }
      }
      if (part.length > 1) parts.push(part);
    } else if (char === "*") {
      parts.push("*");
      i++;
    } else {
      i++;
    }
  }
  return parts;
}
function matchesSingleSelector(entity, selector) {
  if (selector === "*") return true;
  if (selector.startsWith(".")) {
    return entity.type === selector.substring(1);
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const content = selector.slice(1, -1);
    const stringMatch = content.match(/^(\w+)([\^$*]?=)(.+)$/);
    if (stringMatch) {
      const [, key, op, rawValue] = stringMatch;
      const entityValue = String(getEntityValue(entity, key) ?? "");
      const targetValue = rawValue.replace(/^["']|["']$/g, "");
      switch (op) {
        case "=":
          return entityValue === targetValue;
        case "^=":
          return entityValue.startsWith(targetValue);
        case "$=":
          return entityValue.endsWith(targetValue);
        case "*=":
          return entityValue.includes(targetValue);
      }
    }
    const compMatch = content.match(/^(\w+)(>=?|<=?|!=)(.+)$/);
    if (compMatch) {
      const [, key, op, rawValue] = compMatch;
      const entityValue = getEntityValue(entity, key);
      const targetValue = parseValue(rawValue);
      switch (op) {
        case "!=":
          return String(entityValue) !== String(targetValue);
        case ">":
          return Number(entityValue) > Number(targetValue);
        case ">=":
          return Number(entityValue) >= Number(targetValue);
        case "<":
          return Number(entityValue) < Number(targetValue);
        case "<=":
          return Number(entityValue) <= Number(targetValue);
      }
    }
    const presenceMatch = content.match(/^(\w+)$/);
    if (presenceMatch) {
      const [, key] = presenceMatch;
      return getEntityValue(entity, key) !== void 0;
    }
  }
  if (selector.startsWith("#")) {
    return entity.id === selector.substring(1);
  }
  if (selector.startsWith(":contains(") && selector.endsWith(")")) {
    const searchText = selector.slice(10, -1).replace(/^["']|["']$/g, "").toLowerCase();
    return entity.text.toLowerCase().includes(searchText);
  }
  if (selector.startsWith(":page(") && selector.endsWith(")")) {
    const content = selector.slice(6, -1);
    const page = entity.pageIndex + 1;
    const compMatch = content.match(/^(<=?|>=?)(\d+)$/);
    if (compMatch) {
      const [, op, numStr] = compMatch;
      const targetPage = parseInt(numStr, 10);
      switch (op) {
        case "<=":
          return page <= targetPage;
        case "<":
          return page < targetPage;
        case ">=":
          return page >= targetPage;
        case ">":
          return page > targetPage;
      }
    }
    const pageNum = parseInt(content, 10);
    if (!isNaN(pageNum)) {
      return page === pageNum;
    }
  }
  if (selector.startsWith(":pages(") && selector.endsWith(")")) {
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
function getEntityValue(entity, key) {
  if (key in entity.meta) {
    return entity.meta[key];
  }
  if (key in entity) {
    return entity[key];
  }
  return void 0;
}
function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = parseFloat(value);
  if (!isNaN(num)) return num;
  return value.replace(/^["']|["']$/g, "");
}
function createQueryEngine(doc) {
  const allEntities = doc.pages.flatMap((page) => page.entities);
  return (selector) => {
    if (!selector || selector === "*") {
      return new QueryResult(allEntities, doc);
    }
    if (typeof selector === "function") {
      return new QueryResult(allEntities.filter(selector), doc);
    }
    const selectors = splitOrSelector(selector);
    if (selectors.length === 1) {
      const { baseSelector, indexFilter } = parseIndexPseudoSelector(selector);
      let entities = allEntities.filter((e) => matchesSelector(e, baseSelector));
      entities = applyIndexFilter(entities, indexFilter);
      return new QueryResult(entities, doc);
    }
    const matchedIds = /* @__PURE__ */ new Set();
    const matched = [];
    for (const sel of selectors) {
      const trimmed = sel.trim();
      if (!trimmed) continue;
      const { baseSelector, indexFilter } = parseIndexPseudoSelector(trimmed);
      let branchMatches = allEntities.filter((e) => matchesSelector(e, baseSelector));
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
function parseIndexPseudoSelector(selector) {
  const indexPatterns = [
    { regex: /:first$/, type: "first" },
    { regex: /:last$/, type: "last" },
    { regex: /:even$/, type: "even" },
    { regex: /:odd$/, type: "odd" },
    { regex: /:eq\((\d+)\)$/, type: "eq" },
    { regex: /:gt\((\d+)\)$/, type: "gt" },
    { regex: /:lt\((\d+)\)$/, type: "lt" }
  ];
  for (const pattern of indexPatterns) {
    const match = selector.match(pattern.regex);
    if (match) {
      const baseSelector = selector.slice(0, match.index) || "*";
      const value = match[1] !== void 0 ? parseInt(match[1], 10) : void 0;
      return {
        baseSelector: baseSelector.trim() || "*",
        indexFilter: { type: pattern.type, value }
      };
    }
  }
  return { baseSelector: selector, indexFilter: { type: null } };
}
function applyIndexFilter(entities, filter) {
  if (filter.type === null) return entities;
  switch (filter.type) {
    case "first":
      return entities.length > 0 ? [entities[0]] : [];
    case "last":
      return entities.length > 0 ? [entities[entities.length - 1]] : [];
    case "eq":
      return filter.value !== void 0 && entities[filter.value] ? [entities[filter.value]] : [];
    case "gt":
      return filter.value !== void 0 ? entities.slice(filter.value + 1) : entities;
    case "lt":
      return filter.value !== void 0 ? entities.slice(0, filter.value) : entities;
    case "even":
      return entities.filter((_, i) => i % 2 === 0);
    case "odd":
      return entities.filter((_, i) => i % 2 === 1);
    default:
      return entities;
  }
}
function splitOrSelector(selector) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "[" || char === "(") {
      depth++;
      current += char;
    } else if (char === "]" || char === ")") {
      depth--;
      current += char;
    } else if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}
function queryPage(doc, pageNumber) {
  const page = doc.pages.find((p) => p.pageNumber === pageNumber);
  return new QueryResult(page?.entities || [], doc);
}
function queryPages(doc, pageNumbers) {
  const pageSet = new Set(pageNumbers);
  const entities = doc.pages.filter((p) => pageSet.has(p.pageNumber)).flatMap((p) => p.entities);
  return new QueryResult(entities, doc);
}
function toResultItem(entity) {
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
    position: entity.rowIndex !== void 0 ? { row: entity.rowIndex, col: entity.colIndex ?? 0 } : void 0
  };
}
function executeQuery(doc, config) {
  const startTime = Date.now();
  const $$ = createQueryEngine(doc);
  let result = $$(config.selector);
  if (config.pageRange) {
    const [start, end] = config.pageRange;
    result = result.filter((e) => {
      const page = e.pageIndex + 1;
      return page >= start && page <= end;
    });
  }
  if (config.minConfidence !== void 0) {
    result = result.filter(`[confidence>=${config.minConfidence}]`);
  }
  if (config.status) {
    const statuses = Array.isArray(config.status) ? config.status : [config.status];
    result = result.filter((e) => statuses.includes(e.meta.verificationStatus));
  }
  if (config.contains) {
    result = result.contains(config.contains);
  }
  if (config.pattern) {
    result = result.matches(new RegExp(config.pattern, "i"));
  }
  if (config.sortBy) {
    switch (config.sortBy) {
      case "confidence":
        result = result.sortByConfidence();
        break;
      case "position":
        result = result.sortByPosition();
        break;
      case "page":
        result = result.sortBy((e) => e.pageIndex);
        break;
    }
  }
  const stats = result.stats();
  const total = result.length;
  if (config.topK !== void 0 && config.topK > 0) {
    result = result.take(config.topK);
  }
  const items = result.toArray().map(toResultItem);
  return {
    query: config.selector,
    documentId: doc.id,
    total,
    returned: items.length,
    items,
    stats,
    duration: Date.now() - startTime
  };
}
function formatQueryResponse(response, options) {
  const { showStats = true, maxTextLength = 80 } = options ?? {};
  const lines = [];
  lines.push(`Query: ${response.query}`);
  lines.push(`Document: ${response.documentId}`);
  lines.push(`Results: ${response.returned}/${response.total} (${response.duration}ms)`);
  lines.push("");
  for (const item of response.items) {
    const text = item.text.length > maxTextLength ? item.text.substring(0, maxTextLength) + "..." : item.text;
    const textOneLine = text.replace(/\n/g, " ");
    lines.push(`[${item.page}:${item.id}] ${item.type} (${(item.confidence * 100).toFixed(0)}%)`);
    lines.push(`  ${textOneLine}`);
    if (item.value !== void 0) {
      lines.push(`  value: ${item.value}`);
    }
    lines.push("");
  }
  if (showStats) {
    lines.push("---");
    lines.push(`Stats: ${response.stats.verified} verified, ${response.stats.flagged} flagged, ${response.stats.pending} pending`);
    lines.push(`Avg confidence: ${(response.stats.avgConfidence * 100).toFixed(1)}%`);
  }
  return lines.join("\n");
}

// src/sources.ts
var DEFAULT_BBOX = { x: 0, y: 0, width: 1, height: 1 };
function fromEntitiesApi(response) {
  return response.entities.map((entity) => ({
    id: entity.id,
    type: entity.type,
    title: entity.title,
    page: entity.page,
    bbox: entity.bbox ?? DEFAULT_BBOX,
    // Handle missing bbox
    schema: entity.schema,
    isComplete: entity.isComplete,
    caption: entity.caption,
    imageUrl: entity.imageUrl,
    confidence: entity.confidence,
    verification_status: entity.verification_status
  }));
}
function fromPageApiBlocks(response) {
  return response.blocks.map((block, index) => ({
    id: `ocr-${response.page}-${index}`,
    page: response.page,
    text: block.text,
    bbox: block.bbox,
    confidence: block.confidence ?? 0.9
  }));
}
function fromPageApiMarkdown(response) {
  return {
    id: `md-${response.page}`,
    page: response.page,
    content: response.content,
    model: "llamaparse",
    confidence: 0.95
  };
}
function fromPageApiTables(response) {
  return response.metadata.tables.map((table, index) => ({
    id: `table-${response.page}-${index}`,
    page_number: response.page,
    markdown: "",
    // Not available from page API, need to extract from content
    bbox: {
      xmin: table.bbox.x,
      ymin: table.bbox.y,
      xmax: table.bbox.x + table.bbox.width,
      ymax: table.bbox.y + table.bbox.height
    },
    confidence: 0.9,
    verification_status: "pending",
    verified_by: null,
    verified_at: null
  }));
}
async function fetchEntities(jobId, baseUrl = "https://publicusercontent.okrapdf.com", options = {}) {
  const url = `${baseUrl}/api/ocr/jobs/${jobId}/entities?type=all`;
  const response = await fetch(url, {
    headers: { accept: "application/json", ...options.headers }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch entities: ${response.status}`);
  }
  const data = await response.json();
  return fromEntitiesApi(data);
}
async function fetchPage(jobId, pageNumber, baseUrl = "https://publicusercontent.okrapdf.com", options = {}) {
  const url = `${baseUrl}/api/ocr/jobs/${jobId}/pages/${pageNumber}`;
  const response = await fetch(url, {
    headers: { accept: "application/json", ...options.headers }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch page ${pageNumber}: ${response.status}`);
  }
  const data = await response.json();
  return {
    ocr: fromPageApiBlocks(data),
    markdown: fromPageApiMarkdown(data)
  };
}
async function fetchPages(jobId, pageNumbers, baseUrl = "https://publicusercontent.okrapdf.com", options = {}) {
  const results = await Promise.all(
    pageNumbers.map((n) => fetchPage(jobId, n, baseUrl, options))
  );
  return {
    ocr: results.flatMap((r) => r.ocr),
    markdown: results.map((r) => r.markdown)
  };
}
function loadEntitiesFromFile(json) {
  const data = json;
  if (!data.entities) {
    throw new Error("Invalid entities file: missing entities array");
  }
  return fromEntitiesApi(data);
}
function loadPageFromFile(json) {
  const data = json;
  if (typeof data.page !== "number") {
    throw new Error("Invalid page file: missing page number");
  }
  return {
    ocr: fromPageApiBlocks(data),
    markdown: fromPageApiMarkdown(data),
    page: data.page
  };
}

// src/tree-adapter.ts
var TYPE_MAP = {
  "table": "table",
  "figure": "figure",
  "ocr-block": "ocr",
  "footnote": "footnote",
  "summary": "markdown",
  "heading": "header",
  "paragraph": "text",
  "signature": "text",
  "form": "text",
  "list": "text",
  "header": "header"
};
function mapType(inspectorType) {
  return TYPE_MAP[inspectorType] || "unknown";
}
function convertBbox(bbox) {
  return {
    xmin: bbox.x,
    ymin: bbox.y,
    xmax: bbox.x + bbox.width,
    ymax: bbox.y + bbox.height
  };
}
function createEntityMeta(node, defaultConfidence) {
  const confidence = typeof node.attributes["data-confidence"] === "number" ? node.attributes["data-confidence"] : defaultConfidence;
  return {
    verified: false,
    verificationStatus: "pending",
    confidence,
    wasCorrected: false,
    source: "ocr",
    processorType: "ocr"
  };
}
function flattenTree(node, options) {
  const entities = [];
  const { includeOcrBlocks = true, defaultConfidence = 0.9 } = options;
  const traverse = (n) => {
    const isStructuralNode = n.type === "document" || n.type === "page";
    const isOcrBlock = n.type === "ocr-block";
    if (!isStructuralNode && n.bbox) {
      if (isOcrBlock && !includeOcrBlocks) {
        return;
      }
      entities.push({
        id: n.id,
        type: mapType(n.type),
        text: n.textContent || "",
        bbox: convertBbox(n.bbox),
        pageIndex: n.page - 1,
        meta: createEntityMeta(n, defaultConfidence),
        _data: n.data
      });
    }
    n.children.forEach(traverse);
  };
  traverse(node);
  return entities;
}
function groupByPage(entities) {
  const pageMap = /* @__PURE__ */ new Map();
  entities.forEach((e) => {
    const pageIndex = e.pageIndex;
    if (!pageMap.has(pageIndex)) {
      pageMap.set(pageIndex, []);
    }
    pageMap.get(pageIndex).push(e);
  });
  return pageMap;
}
function createPageMeta(entities) {
  const total = entities.length;
  const verified = entities.filter((e) => e.meta.verified).length;
  const flagged = entities.filter((e) => e.meta.verificationStatus === "flagged").length;
  const pending = entities.filter((e) => e.meta.verificationStatus === "pending").length;
  const avgConfidence = total > 0 ? entities.reduce((sum, e) => sum + e.meta.confidence, 0) / total : 0;
  return {
    totalEntities: total,
    verifiedCount: verified,
    flaggedCount: flagged,
    pendingCount: pending,
    avgConfidence,
    verificationScore: total > 0 ? verified / total : 0
  };
}
function treeToVirtualDoc(tree, options = {}) {
  const { docId = "inspector-doc" } = options;
  const entities = flattenTree(tree, options);
  const pageMap = groupByPage(entities);
  const pages = Array.from(pageMap.entries()).sort(([a], [b]) => a - b).map(([pageIndex, pageEntities]) => ({
    id: `page-${pageIndex + 1}`,
    pageIndex,
    pageNumber: pageIndex + 1,
    entities: pageEntities,
    meta: createPageMeta(pageEntities)
  }));
  const totalEntities = entities.length;
  const verifiedCount = entities.filter((e) => e.meta.verified).length;
  const flaggedCount = entities.filter((e) => e.meta.verificationStatus === "flagged").length;
  const pendingCount = entities.filter((e) => e.meta.verificationStatus === "pending").length;
  return {
    id: docId,
    version: 1,
    pages,
    meta: {
      totalPages: pages.length,
      totalEntities,
      verifiedCount,
      flaggedCount,
      pendingCount,
      verificationScore: totalEntities > 0 ? verifiedCount / totalEntities : 0,
      createdAt: Date.now(),
      lastModified: Date.now()
    }
  };
}
function getPageCount(tree) {
  let maxPage = 0;
  const traverse = (n) => {
    if (n.page > maxPage) maxPage = n.page;
    n.children.forEach(traverse);
  };
  traverse(tree);
  return maxPage;
}
export {
  DocCompiler,
  QueryResult,
  compileDocument,
  createCompiler,
  createQueryEngine,
  executeQuery,
  fetchEntities,
  fetchPage,
  fetchPages,
  formatQueryResponse,
  fromEntitiesApi,
  fromPageApiBlocks,
  fromPageApiMarkdown,
  fromPageApiTables,
  getPageCount,
  loadEntitiesFromFile,
  loadPageFromFile,
  queryPage,
  queryPages,
  treeToVirtualDoc
};
