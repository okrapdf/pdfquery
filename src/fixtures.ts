/**
 * Sample Fixtures
 *
 * Pre-built sample documents for testing and demos.
 * Use these to try pdfquery without any external API dependencies.
 *
 * @example
 * import { loadFixture, fixtures } from 'pdfquery/fixtures';
 *
 * // Quick start - get a compiled VirtualDoc
 * const doc = loadFixture('financial-report');
 * const $$ = createQueryEngine(doc);
 * $$('.table').stats();
 *
 * // Or access raw fixture data
 * const raw = fixtures.invoice;
 */

import { DocCompiler } from './compiler';
import type { VirtualDoc, SourceTable, SourceEntity, SourceExtractedEntity, SourceOcr } from './types';
import type { EntitiesApiResponse, PageApiResponse } from './sources';
import { fromEntitiesApi, fromPageApiBlocks } from './sources';

// ============================================================================
// Fixture Types
// ============================================================================

export interface FixtureData {
  metadata: {
    documentId: string;
    fileName: string;
    totalPages: number;
    documentType: string;
  };
  entities?: Array<{
    id: string;
    type: 'table' | 'figure' | 'footnote' | 'summary';
    title: string;
    page: number;
    bbox: { x: number; y: number; width: number; height: number };
    schema?: string[];
    isComplete?: boolean;
    caption?: string;
    confidence?: number;
  }>;
  tables?: SourceTable[];
  fieldEntities?: SourceEntity[];
  pages?: Array<{
    page: number;
    blocks: Array<{
      text: string;
      bbox: { x: number; y: number; width: number; height: number };
      confidence?: number;
    }>;
    content: string;
  }>;
}

export type FixtureName = 'financial-report' | 'invoice';

// ============================================================================
// Embedded Fixtures (inlined for zero-dependency usage)
// ============================================================================

const financialReportFixture: FixtureData = {
  metadata: {
    documentId: "sample-financial-report",
    fileName: "Q3-2025-Earnings.pdf",
    totalPages: 3,
    documentType: "financial_report"
  },
  entities: [
    { id: "table-1-0", type: "table", title: "Quarterly Financial Highlights", page: 1, bbox: { x: 0.05, y: 0.15, width: 0.9, height: 0.35 }, schema: ["Metric", "Q3 2025", "Q2 2025", "Q3 2024", "Q/Q Change", "Y/Y Change"], isComplete: true, confidence: 0.98 },
    { id: "table-1-1", type: "table", title: "Revenue by Segment", page: 1, bbox: { x: 0.05, y: 0.55, width: 0.9, height: 0.25 }, schema: ["Segment", "Revenue", "% of Total"], isComplete: true, confidence: 0.96 },
    { id: "figure-2-0", type: "figure", title: "Revenue Growth Trend", page: 2, bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }, caption: "Year-over-year revenue growth by quarter", confidence: 0.92 },
    { id: "table-2-0", type: "table", title: "Income Statement Summary", page: 2, bbox: { x: 0.05, y: 0.65, width: 0.9, height: 0.3 }, schema: ["Line Item", "Q3 2025", "Q3 2024"], isComplete: true, confidence: 0.97 },
    { id: "footnote-2-0", type: "footnote", title: "(1) Non-GAAP measures exclude stock-based compensation", page: 2, bbox: { x: 0.05, y: 0.96, width: 0.9, height: 0.03 }, confidence: 0.89 },
    { id: "table-3-0", type: "table", title: "Balance Sheet Highlights", page: 3, bbox: { x: 0.05, y: 0.1, width: 0.9, height: 0.4 }, schema: ["Item", "Sep 30, 2025", "Dec 31, 2024"], isComplete: true, confidence: 0.95 }
  ],
  tables: [
    { id: "table-1-0", page_number: 1, markdown: "| Metric | Q3 2025 | Q2 2025 | Q3 2024 | Q/Q Change | Y/Y Change |\n|---|---|---|---|---|---|\n| Revenue | $12,500M | $11,200M | $9,800M | +12% | +28% |\n| Gross Margin | 68.5% | 67.2% | 65.8% | +1.3 pts | +2.7 pts |\n| Operating Income | $4,200M | $3,650M | $2,900M | +15% | +45% |\n| Net Income | $3,100M | $2,750M | $2,200M | +13% | +41% |\n| Diluted EPS | $2.45 | $2.18 | $1.74 | +12% | +41% |", bbox: { xmin: 0.05, ymin: 0.15, xmax: 0.95, ymax: 0.5 }, confidence: 0.98, verification_status: "pending", verified_by: null, verified_at: null },
    { id: "table-1-1", page_number: 1, markdown: "| Segment | Revenue | % of Total |\n|---|---|---|\n| Cloud Services | $7,500M | 60% |\n| Enterprise Software | $3,750M | 30% |\n| Professional Services | $1,250M | 10% |", bbox: { xmin: 0.05, ymin: 0.55, xmax: 0.95, ymax: 0.8 }, confidence: 0.96, verification_status: "pending", verified_by: null, verified_at: null },
    { id: "table-2-0", page_number: 2, markdown: "| Line Item | Q3 2025 | Q3 2024 |\n|---|---|---|\n| Revenue | $12,500M | $9,800M |\n| Cost of Revenue | $3,938M | $3,352M |\n| Gross Profit | $8,562M | $6,448M |\n| R&D Expenses | $2,100M | $1,750M |\n| S&M Expenses | $1,500M | $1,200M |\n| G&A Expenses | $762M | $598M |\n| Operating Income | $4,200M | $2,900M |", bbox: { xmin: 0.05, ymin: 0.65, xmax: 0.95, ymax: 0.95 }, confidence: 0.97, verification_status: "pending", verified_by: null, verified_at: null },
    { id: "table-3-0", page_number: 3, markdown: "| Item | Sep 30, 2025 | Dec 31, 2024 |\n|---|---|---|\n| Cash & Equivalents | $8,200M | $6,500M |\n| Accounts Receivable | $2,800M | $2,100M |\n| Total Assets | $45,000M | $38,000M |\n| Total Debt | $5,500M | $6,000M |\n| Shareholders' Equity | $28,000M | $22,500M |", bbox: { xmin: 0.05, ymin: 0.1, xmax: 0.95, ymax: 0.5 }, confidence: 0.95, verification_status: "pending", verified_by: null, verified_at: null }
  ]
};

const invoiceFixture: FixtureData = {
  metadata: {
    documentId: "sample-invoice",
    fileName: "INV-2025-0042.pdf",
    totalPages: 1,
    documentType: "invoice"
  },
  entities: [
    { id: "table-1-0", type: "table", title: "Line Items", page: 1, bbox: { x: 0.05, y: 0.35, width: 0.9, height: 0.35 }, schema: ["Item", "Description", "Qty", "Unit Price", "Amount"], isComplete: true, confidence: 0.96 }
  ],
  tables: [
    { id: "table-1-0", page_number: 1, markdown: "| Item | Description | Qty | Unit Price | Amount |\n|---|---|---|---|---|\n| PDF-001 | Document Processing API - Standard | 1,000 | $0.05 | $50.00 |\n| PDF-002 | Table Extraction Add-on | 500 | $0.08 | $40.00 |\n| PDF-003 | Priority Support (Monthly) | 1 | $99.00 | $99.00 |\n| | | | Subtotal | $189.00 |\n| | | | Tax (8.5%) | $16.07 |\n| | | | **Total** | **$205.07** |", bbox: { xmin: 0.05, ymin: 0.35, xmax: 0.95, ymax: 0.7 }, confidence: 0.96, verification_status: "pending", verified_by: null, verified_at: null }
  ],
  fieldEntities: [
    { id: "field-invoice-number", page_number: 1, field_label: "Invoice Number", suggested_value: "INV-2025-0042", confidence: 0.99, bounding_box: { x: 0.7, y: 0.1, width: 0.2, height: 0.03 }, verification_status: "pending" } as SourceEntity,
    { id: "field-invoice-date", page_number: 1, field_label: "Invoice Date", suggested_value: "2025-01-15", confidence: 0.98, bounding_box: { x: 0.7, y: 0.14, width: 0.2, height: 0.03 }, verification_status: "pending" } as SourceEntity,
    { id: "field-due-date", page_number: 1, field_label: "Due Date", suggested_value: "2025-02-14", confidence: 0.97, bounding_box: { x: 0.7, y: 0.18, width: 0.2, height: 0.03 }, verification_status: "pending" } as SourceEntity,
    { id: "field-total", page_number: 1, field_label: "Total", suggested_value: "$205.07", suggested_value_numeric: 205.07, confidence: 0.98, bounding_box: { x: 0.75, y: 0.68, width: 0.15, height: 0.03 }, verification_status: "pending" } as SourceEntity
  ]
};

// ============================================================================
// Exports
// ============================================================================

/**
 * Raw fixture data by name
 */
export const fixtures = {
  'financial-report': financialReportFixture,
  'invoice': invoiceFixture,
} as const;

/**
 * List available fixture names
 */
export function listFixtures(): FixtureName[] {
  return Object.keys(fixtures) as FixtureName[];
}

/**
 * Get raw fixture data
 */
export function getFixture(name: FixtureName): FixtureData {
  const fixture = fixtures[name];
  if (!fixture) {
    throw new Error(`Unknown fixture: ${name}. Available: ${listFixtures().join(', ')}`);
  }
  return fixture;
}

/**
 * Load a fixture and compile it into a VirtualDoc
 *
 * @example
 * import { loadFixture, createQueryEngine } from 'pdfquery';
 *
 * const doc = loadFixture('financial-report');
 * const $$ = createQueryEngine(doc);
 *
 * // Query tables
 * $$('.table').count();  // 4
 * $$('.currency').sum(); // aggregate currency values
 */
export function loadFixture(name: FixtureName): VirtualDoc {
  const fixture = getFixture(name);

  const compiler = new DocCompiler({
    documentId: fixture.metadata.documentId,
    fileName: fixture.metadata.fileName,
    documentType: fixture.metadata.documentType,
  });

  // Add tables if present
  if (fixture.tables) {
    compiler.addTables(fixture.tables);
  }

  // Add field entities if present
  if (fixture.fieldEntities) {
    compiler.addEntities(fixture.fieldEntities);
  }

  // Add extracted entities if present (from entities array)
  if (fixture.entities) {
    const extractedEntities: SourceExtractedEntity[] = fixture.entities.map(e => ({
      id: e.id,
      type: e.type,
      title: e.title,
      page: e.page,
      bbox: e.bbox,
      schema: e.schema,
      isComplete: e.isComplete,
      caption: e.caption,
      confidence: e.confidence,
    }));
    compiler.addExtractedEntities(extractedEntities);
  }

  return compiler.compile();
}

/**
 * Compile custom fixture data into a VirtualDoc
 *
 * @example
 * const myData = { metadata: {...}, tables: [...] };
 * const doc = compileFixture(myData);
 */
export function compileFixture(data: FixtureData): VirtualDoc {
  const compiler = new DocCompiler({
    documentId: data.metadata.documentId,
    fileName: data.metadata.fileName,
    documentType: data.metadata.documentType,
  });

  if (data.tables) {
    compiler.addTables(data.tables);
  }

  if (data.fieldEntities) {
    compiler.addEntities(data.fieldEntities);
  }

  if (data.entities) {
    const extractedEntities: SourceExtractedEntity[] = data.entities.map(e => ({
      id: e.id,
      type: e.type,
      title: e.title,
      page: e.page,
      bbox: e.bbox,
      schema: e.schema,
      isComplete: e.isComplete,
      caption: e.caption,
      confidence: e.confidence,
    }));
    compiler.addExtractedEntities(extractedEntities);
  }

  return compiler.compile();
}
