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

import type {
  VirtualDoc,
  VirtualPage,
  VirtualEntity,
  EntityType,
  EntityMeta,
  BoundingBox,
  PageMeta,
  DocumentMeta,
  SourceTable,
  SourceEntity,
  SourceExtractedEntity,
  SourceOcr,
  SourceMarkdown,
  CompilerOptions,
  VerificationStatus,
} from './types';

// ============================================================================
// Entity Type Detection
// ============================================================================

const CURRENCY_PATTERN = /^[\$£€¥]?\s*-?[\d,]+\.?\d*\s*(?:万|亿|千)?$/;
const PERCENTAGE_PATTERN = /^-?\d+\.?\d*\s*%$/;
const DATE_PATTERN = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$|^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/;
const NUMBER_PATTERN = /^-?[\d,]+\.?\d*$/;

function detectEntityType(text: string, label?: string): EntityType {
  const trimmed = text.trim();

  // Check label hints first
  if (label) {
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.includes('total')) return 'total';
    if (lowerLabel.includes('subtotal')) return 'subtotal';
    if (lowerLabel.includes('date')) return 'date';
  }

  // Pattern matching
  if (CURRENCY_PATTERN.test(trimmed)) return 'currency';
  if (PERCENTAGE_PATTERN.test(trimmed)) return 'percentage';
  if (DATE_PATTERN.test(trimmed)) return 'date';
  if (NUMBER_PATTERN.test(trimmed)) return 'number';

  // Check for short text (likely label)
  if (trimmed.length < 50 && !trimmed.includes('\n')) return 'label';

  return 'text';
}

// ============================================================================
// Markdown Table Parser
// ============================================================================

interface ParsedTableRow {
  cells: string[];
  isHeader: boolean;
}

interface ParsedTable {
  rows: ParsedTableRow[];
  columnCount: number;
}

function parseMarkdownTable(markdown: string): ParsedTable {
  const lines = markdown.split('\n').filter(line => line.trim());
  const rows: ParsedTableRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip separator lines (e.g., |---|---|)
    if (/^\|?\s*[-:]+\s*\|/.test(line)) continue;

    // Parse table row
    if (line.startsWith('|') || line.includes('|')) {
      const cells = line
        .split('|')
        .map(cell => cell.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      if (cells.length > 0) {
        rows.push({
          cells,
          isHeader: rows.length === 0, // First row is header
        });
      }
    }
  }

  const columnCount = Math.max(...rows.map(r => r.cells.length), 0);

  return { rows, columnCount };
}

// ============================================================================
// DocCompiler Class
// ============================================================================

export class DocCompiler {
  private options: Required<CompilerOptions>;
  private tables: SourceTable[] = [];
  private entities: SourceEntity[] = [];
  private extractedEntities: SourceExtractedEntity[] = [];
  private ocrBlocks: SourceOcr[] = [];
  private markdownBlocks: SourceMarkdown[] = [];
  private version = 1;

  constructor(options: CompilerOptions = {}) {
    this.options = {
      includeTables: options.includeTables ?? true,
      parseTableCells: options.parseTableCells ?? true,
      autoDetectTypes: options.autoDetectTypes ?? true,
      documentId: options.documentId ?? `doc_${Date.now()}`,
      fileName: options.fileName ?? 'unknown',
      documentType: options.documentType ?? 'document',
    };
  }

  // --------------------------------------------------------------------------
  // Data Input Methods
  // --------------------------------------------------------------------------

  /**
   * Add extracted tables from API response
   */
  addTables(tables: SourceTable[]): this {
    this.tables.push(...tables);
    return this;
  }

  /**
   * Add extracted entities from API response
   */
  addEntities(entities: SourceEntity[]): this {
    this.entities.push(...entities);
    return this;
  }

  /**
   * Add extracted entities from /api/ocr/jobs/{id}/entities
   * Unified format for tables, figures, footnotes, summaries
   */
  addExtractedEntities(entities: SourceExtractedEntity[]): this {
    this.extractedEntities.push(...entities);
    return this;
  }

  /**
   * Add raw OCR text blocks
   */
  addOcrBlocks(blocks: SourceOcr[]): this {
    this.ocrBlocks.push(...blocks);
    return this;
  }

  /**
   * Add LLM vision markdown output
   */
  addMarkdownBlocks(blocks: SourceMarkdown[]): this {
    this.markdownBlocks.push(...blocks);
    return this;
  }

  /**
   * Add a single markdown page (for direct markdown input)
   */
  addMarkdownPage(markdown: string, pageNumber: number): this {
    // Create a synthetic table from the markdown
    this.tables.push({
      id: `synthetic_${pageNumber}_${Date.now()}`,
      page_number: pageNumber,
      markdown,
      bbox: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 },
      confidence: 1,
      verification_status: 'pending',
      verified_by: null,
      verified_at: null,
    });
    return this;
  }

  /**
   * Reset compiler state for reuse
   */
  reset(): this {
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
  compile(): VirtualDoc {
    const now = Date.now();

    // Group by page number
    const pageMap = new Map<number, {
      tables: SourceTable[];
      entities: SourceEntity[];
      extractedEntities: SourceExtractedEntity[];
      ocrBlocks: SourceOcr[];
      markdownBlocks: SourceMarkdown[];
    }>();

    // Collect all page numbers from all sources
    const allPageNumbers = new Set<number>();
    this.tables.forEach(t => allPageNumbers.add(t.page_number));
    this.entities.forEach(e => allPageNumbers.add(e.page_number));
    this.extractedEntities.forEach(e => allPageNumbers.add(e.page));
    this.ocrBlocks.forEach(o => allPageNumbers.add(o.page));
    this.markdownBlocks.forEach(m => allPageNumbers.add(m.page));

    // Initialize page groups
    for (const pageNum of allPageNumbers) {
      pageMap.set(pageNum, {
        tables: [],
        entities: [],
        extractedEntities: [],
        ocrBlocks: [],
        markdownBlocks: [],
      });
    }

    // Group all data by page
    for (const table of this.tables) {
      pageMap.get(table.page_number)!.tables.push(table);
    }
    for (const entity of this.entities) {
      pageMap.get(entity.page_number)!.entities.push(entity);
    }
    for (const extracted of this.extractedEntities) {
      pageMap.get(extracted.page)!.extractedEntities.push(extracted);
    }
    for (const ocr of this.ocrBlocks) {
      pageMap.get(ocr.page)!.ocrBlocks.push(ocr);
    }
    for (const md of this.markdownBlocks) {
      pageMap.get(md.page)!.markdownBlocks.push(md);
    }

    // Build pages
    const pages: VirtualPage[] = [];
    const sortedPageNumbers = Array.from(allPageNumbers).sort((a, b) => a - b);

    for (const pageNum of sortedPageNumbers) {
      const pageData = pageMap.get(pageNum)!;
      const page = this.buildPage(
        pageNum,
        pageData.tables,
        pageData.entities,
        pageData.extractedEntities,
        pageData.ocrBlocks,
        pageData.markdownBlocks,
      );
      pages.push(page);
    }

    // Calculate document-level stats
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

    const meta: DocumentMeta = {
      fileName: this.options.fileName,
      documentType: this.options.documentType,
      totalPages: pages.length,
      totalEntities,
      verifiedCount,
      flaggedCount,
      pendingCount,
      verificationScore: totalEntities > 0 ? verifiedCount / totalEntities : 0,
      createdAt: now,
      lastModified: now,
    };

    return {
      id: this.options.documentId,
      version: this.version,
      pages,
      meta,
    };
  }

  // --------------------------------------------------------------------------
  // Page Building
  // --------------------------------------------------------------------------

  private buildPage(
    pageNumber: number,
    tables: SourceTable[],
    entities: SourceEntity[],
    extractedEntities: SourceExtractedEntity[] = [],
    ocrBlocks: SourceOcr[] = [],
    markdownBlocks: SourceMarkdown[] = [],
  ): VirtualPage {
    const pageIndex = pageNumber - 1; // Convert to 0-based
    const virtualEntities: VirtualEntity[] = [];

    // Process tables (from SourceTable format with markdown)
    if (this.options.includeTables) {
      for (const table of tables) {
        // Add table as a container entity
        const tableEntity = this.tableToEntity(table, pageIndex);
        virtualEntities.push(tableEntity);

        // Parse table cells as individual entities
        if (this.options.parseTableCells && table.markdown) {
          const cellEntities = this.parseTableCells(table, pageIndex);
          virtualEntities.push(...cellEntities);
        }
      }
    }

    // Process standalone entities (field-level extractions)
    for (const entity of entities) {
      virtualEntities.push(this.sourceEntityToVirtual(entity, pageIndex));
    }

    // Process extracted entities (unified format: table, figure, footnote, summary)
    for (const extracted of extractedEntities) {
      virtualEntities.push(this.extractedEntityToVirtual(extracted, pageIndex));
    }

    // Process OCR blocks
    for (const ocr of ocrBlocks) {
      virtualEntities.push(this.ocrBlockToVirtual(ocr, pageIndex));
    }

    // Process markdown blocks (LLM vision output)
    for (const md of markdownBlocks) {
      virtualEntities.push(this.markdownBlockToVirtual(md, pageIndex));
    }

    // Sort by vertical position
    virtualEntities.sort((a, b) => a.bbox.ymin - b.bbox.ymin);

    // Calculate page stats
    const meta = this.calculatePageMeta(virtualEntities);

    // Extract raw markdown (first markdown block content, or combine if multiple)
    const markdown = markdownBlocks.length > 0
      ? markdownBlocks.map(m => m.content).join('\n\n')
      : undefined;

    return {
      id: `p_${pageIndex}`,
      pageIndex,
      pageNumber,
      entities: virtualEntities,
      meta,
      markdown,
    };
  }

  // --------------------------------------------------------------------------
  // Entity Conversion
  // --------------------------------------------------------------------------

  private tableToEntity(table: SourceTable, pageIndex: number): VirtualEntity {
    const status = table.verification_status || 'pending';

    return {
      id: table.id,
      type: 'table',
      text: table.markdown,
      bbox: {
        xmin: table.bbox.xmin,
        ymin: table.bbox.ymin,
        xmax: table.bbox.xmax,
        ymax: table.bbox.ymax,
      },
      meta: this.buildMeta({
        confidence: table.confidence ?? 0,
        verificationStatus: status,
        verified: status === 'verified',
        verifiedBy: table.verified_by ?? undefined,
        verifiedAt: table.verified_at ? new Date(table.verified_at).getTime() : undefined,
        wasCorrected: table.was_corrected ?? false,
        source: 'ocr',
      }),
      pageIndex,
    };
  }

  private parseTableCells(table: SourceTable, pageIndex: number): VirtualEntity[] {
    const entities: VirtualEntity[] = [];
    const parsed = parseMarkdownTable(table.markdown);

    if (parsed.rows.length === 0) return entities;

    // Calculate cell bounding boxes (approximate)
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

        const cellBbox: BoundingBox = {
          xmin: xmin + colIdx * colWidth,
          ymin: ymin + rowIdx * rowHeight,
          xmax: xmin + (colIdx + 1) * colWidth,
          ymax: ymin + (rowIdx + 1) * rowHeight,
        };

        const entityType = row.isHeader
          ? 'header'
          : this.options.autoDetectTypes
            ? detectEntityType(cellText)
            : 'table_cell';

        entities.push({
          id: `${table.id}_r${rowIdx}_c${colIdx}`,
          type: entityType,
          text: cellText,
          value: this.parseValue(cellText, entityType),
          bbox: cellBbox,
          meta: this.buildMeta({
            confidence: table.confidence ?? 0,
            verificationStatus: table.verification_status || 'pending',
            verified: table.verification_status === 'verified',
            wasCorrected: false,
            source: 'ocr',
          }),
          pageIndex,
          tableId: table.id,
          rowIndex: rowIdx,
          colIndex: colIdx,
        });
      }
    }

    return entities;
  }

  private sourceEntityToVirtual(entity: SourceEntity, pageIndex: number): VirtualEntity {
    const status = entity.verification_status || 'pending';
    const entityType = this.options.autoDetectTypes
      ? detectEntityType(entity.suggested_value, entity.field_label)
      : 'text';

    // Convert x/y/width/height to xmin/ymin/xmax/ymax
    const bbox: BoundingBox = {
      xmin: entity.bounding_box.x,
      ymin: entity.bounding_box.y,
      xmax: entity.bounding_box.x + entity.bounding_box.width,
      ymax: entity.bounding_box.y + entity.bounding_box.height,
    };

    return {
      id: entity.id,
      type: entityType,
      text: entity.verified_value || entity.suggested_value,
      value: entity.suggested_value_numeric ?? undefined,
      bbox,
      meta: this.buildMeta({
        confidence: entity.confidence,
        verificationStatus: status,
        verified: status === 'verified',
        verifiedAt: entity.verified_at ? new Date(entity.verified_at).getTime() : undefined,
        wasCorrected: entity.was_corrected,
        flagReason: entity.flag_reason ?? undefined,
        flaggedAt: entity.flagged_at ? new Date(entity.flagged_at).getTime() : undefined,
        source: 'ocr',
      }),
      pageIndex,
      rowIndex: entity.row_index ?? undefined,
    };
  }

  /**
   * Convert unified extracted entity (table, figure, footnote, summary) to VirtualEntity
   */
  private extractedEntityToVirtual(entity: SourceExtractedEntity, pageIndex: number): VirtualEntity {
    const status = entity.verification_status || 'pending';

    // Map type from API to EntityType
    // Pass through recognized types, fallback to 'text' for summary, 'unknown' for truly unknown
    const typeMap: Record<string, EntityType> = {
      table: 'table',
      figure: 'figure',
      footnote: 'footnote',
      summary: 'text',
      signature: 'text', // signatures are treated as text entities
    };
    // Use mapped type if available, otherwise try to use original type, fallback to 'unknown'
    const entityType = typeMap[entity.type] || (entity.type as EntityType) || 'unknown';

    // Convert x/y/width/height to xmin/ymin/xmax/ymax
    const bbox: BoundingBox = {
      xmin: entity.bbox.x,
      ymin: entity.bbox.y,
      xmax: entity.bbox.x + entity.bbox.width,
      ymax: entity.bbox.y + entity.bbox.height,
    };

    // Use title as primary text, append caption for figures
    let text = entity.title;
    if (entity.caption) {
      text = `${entity.title}\n${entity.caption}`;
    }

    return {
      id: entity.id,
      type: entityType,
      text,
      bbox,
      meta: this.buildMeta({
        confidence: entity.confidence ?? 1,
        verificationStatus: status,
        verified: status === 'verified',
        source: 'ocr',
      }),
      pageIndex,
    };
  }

  /**
   * Convert OCR block to VirtualEntity
   */
  private ocrBlockToVirtual(ocr: SourceOcr, pageIndex: number): VirtualEntity {
    const status = ocr.verification_status || 'pending';

    const bbox: BoundingBox = {
      xmin: ocr.bbox.x,
      ymin: ocr.bbox.y,
      xmax: ocr.bbox.x + ocr.bbox.width,
      ymax: ocr.bbox.y + ocr.bbox.height,
    };

    return {
      id: ocr.id,
      type: 'ocr',
      text: ocr.text,
      bbox,
      meta: this.buildMeta({
        confidence: ocr.confidence,
        verificationStatus: status,
        verified: status === 'verified',
        source: 'ocr',
      }),
      pageIndex,
    };
  }

  /**
   * Convert LLM vision markdown output to VirtualEntity
   */
  private markdownBlockToVirtual(md: SourceMarkdown, pageIndex: number): VirtualEntity {
    const status = md.verification_status || 'pending';

    // Full page bbox for markdown (covers entire page)
    const bbox: BoundingBox = {
      xmin: 0,
      ymin: 0,
      xmax: 1,
      ymax: 1,
    };

    return {
      id: md.id,
      type: 'markdown',
      text: md.content,
      bbox,
      meta: this.buildMeta({
        confidence: md.confidence ?? 1,
        verificationStatus: status,
        verified: status === 'verified',
        source: 'ai_correction',
        processorType: md.model as EntityMeta['processorType'],
      }),
      pageIndex,
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private buildMeta(partial: Partial<EntityMeta>): EntityMeta {
    return {
      verified: partial.verified ?? false,
      verificationStatus: partial.verificationStatus ?? 'pending',
      verifiedBy: partial.verifiedBy,
      verifiedAt: partial.verifiedAt,
      confidence: partial.confidence ?? 0,
      wasCorrected: partial.wasCorrected ?? false,
      correctionType: partial.correctionType,
      source: partial.source ?? 'system',
      processorType: partial.processorType,
      flagReason: partial.flagReason,
      flaggedBy: partial.flaggedBy,
      flaggedAt: partial.flaggedAt,
    };
  }

  private parseValue(text: string, type: EntityType): string | number | undefined {
    if (type === 'currency' || type === 'number') {
      const cleaned = text.replace(/[^\d.-]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? undefined : num;
    }
    if (type === 'percentage') {
      const cleaned = text.replace(/[^\d.-]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? undefined : num / 100;
    }
    return undefined;
  }

  private calculatePageMeta(entities: VirtualEntity[]): PageMeta {
    const total = entities.length;
    let verified = 0;
    let flagged = 0;
    let pending = 0;
    let confidenceSum = 0;

    for (const entity of entities) {
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
      totalEntities: total,
      verifiedCount: verified,
      flaggedCount: flagged,
      pendingCount: pending,
      avgConfidence: total > 0 ? confidenceSum / total : 0,
      verificationScore: total > 0 ? verified / total : 0,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new DocCompiler instance
 */
export function createCompiler(options?: CompilerOptions): DocCompiler {
  return new DocCompiler(options);
}

/**
 * Quick compile from tables and entities
 */
export function compileDocument(
  tables: SourceTable[],
  entities: SourceEntity[],
  options?: CompilerOptions
): VirtualDoc {
  return new DocCompiler(options)
    .addTables(tables)
    .addEntities(entities)
    .compile();
}
