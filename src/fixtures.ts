/**
 * Sample Fixtures
 *
 * Pre-built sample documents for testing and demos.
 * Use these to try pdfquery without any external API dependencies.
 *
 * @example
 * import { loadFixture, fixtures } from 'pdfquery/fixtures';
 *
 * // Quick start - get a session
 * const session = loadFixture('financial-report');
 * session.$('.table').stats();
 *
 * // Or get raw tags
 * const tags = loadFixtureTags('invoice');
 * const session = pdfquery.ready({ tags });
 * session.$('.currency').sum();
 */

import type { Tag } from './tag';
import { expandTableTag, enrichTag } from './tag-utils';
import pdfquery, { type PDFQuerySession } from './session';

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
  tags: Tag[];
}

export type FixtureName = 'financial-report' | 'invoice';

// ============================================================================
// Embedded Fixtures (inlined Tag literals)
// ============================================================================

function makeTableTag(
  id: string,
  page: number,
  markdown: string,
  bbox: { x: number; y: number; width: number; height: number },
  confidence: number,
): Tag {
  return {
    id,
    type: 'table',
    page,
    bbox,
    text: markdown,
    attrs: { confidence, verificationStatus: 'pending' },
  };
}

function makeEntityTag(
  id: string,
  type: string,
  page: number,
  text: string,
  bbox: { x: number; y: number; width: number; height: number },
  confidence: number,
  extra?: Record<string, unknown>,
): Tag {
  return {
    id,
    type,
    page,
    bbox,
    text,
    attrs: { confidence, verificationStatus: 'pending', ...extra },
  };
}

function makeFieldTag(
  id: string,
  page: number,
  label: string,
  value: string,
  bbox: { x: number; y: number; width: number; height: number },
  confidence: number,
  numericValue?: number,
): Tag {
  return {
    id,
    type: 'text', // enrichTag will promote to currency/date/etc
    page,
    bbox,
    text: value,
    attrs: {
      confidence,
      verificationStatus: 'pending',
      fieldLabel: label,
      ...(numericValue !== undefined && { value: numericValue }),
    },
  };
}

function buildFinancialReportTags(): Tag[] {
  const tags: Tag[] = [];

  // Extracted entities (table headers, figures, footnotes)
  tags.push(
    makeEntityTag('table-1-0', 'table', 1, 'Quarterly Financial Highlights', { x: 0.05, y: 0.15, width: 0.9, height: 0.35 }, 0.98, { schema: ['Metric', 'Q3 2025', 'Q2 2025', 'Q3 2024', 'Q/Q Change', 'Y/Y Change'], isComplete: true }),
    makeEntityTag('table-1-1', 'table', 1, 'Revenue by Segment', { x: 0.05, y: 0.55, width: 0.9, height: 0.25 }, 0.96, { schema: ['Segment', 'Revenue', '% of Total'], isComplete: true }),
    makeEntityTag('figure-2-0', 'figure', 2, 'Revenue Growth Trend\nYear-over-year revenue growth by quarter', { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }, 0.92),
    makeEntityTag('table-2-0', 'table', 2, 'Income Statement Summary', { x: 0.05, y: 0.65, width: 0.9, height: 0.3 }, 0.97, { schema: ['Line Item', 'Q3 2025', 'Q3 2024'], isComplete: true }),
    makeEntityTag('footnote-2-0', 'footnote', 2, '(1) Non-GAAP measures exclude stock-based compensation', { x: 0.05, y: 0.96, width: 0.9, height: 0.03 }, 0.89),
    makeEntityTag('table-3-0', 'table', 3, 'Balance Sheet Highlights', { x: 0.05, y: 0.1, width: 0.9, height: 0.4 }, 0.95, { schema: ['Item', 'Sep 30, 2025', 'Dec 31, 2024'], isComplete: true }),
  );

  // Table markdown content + cell expansion
  const tableDefs: Array<{ id: string; page: number; markdown: string; bbox: { x: number; y: number; width: number; height: number }; confidence: number }> = [
    { id: 'table-1-0', page: 1, markdown: '| Metric | Q3 2025 | Q2 2025 | Q3 2024 | Q/Q Change | Y/Y Change |\n|---|---|---|---|---|---|\n| Revenue | $12,500M | $11,200M | $9,800M | +12% | +28% |\n| Gross Margin | 68.5% | 67.2% | 65.8% | +1.3 pts | +2.7 pts |\n| Operating Income | $4,200M | $3,650M | $2,900M | +15% | +45% |\n| Net Income | $3,100M | $2,750M | $2,200M | +13% | +41% |\n| Diluted EPS | $2.45 | $2.18 | $1.74 | +12% | +41% |', bbox: { x: 0.05, y: 0.15, width: 0.9, height: 0.35 }, confidence: 0.98 },
    { id: 'table-1-1', page: 1, markdown: '| Segment | Revenue | % of Total |\n|---|---|---|\n| Cloud Services | $7,500M | 60% |\n| Enterprise Software | $3,750M | 30% |\n| Professional Services | $1,250M | 10% |', bbox: { x: 0.05, y: 0.55, width: 0.9, height: 0.25 }, confidence: 0.96 },
    { id: 'table-2-0', page: 2, markdown: '| Line Item | Q3 2025 | Q3 2024 |\n|---|---|---|\n| Revenue | $12,500M | $9,800M |\n| Cost of Revenue | $3,938M | $3,352M |\n| Gross Profit | $8,562M | $6,448M |\n| R&D Expenses | $2,100M | $1,750M |\n| S&M Expenses | $1,500M | $1,200M |\n| G&A Expenses | $762M | $598M |\n| Operating Income | $4,200M | $2,900M |', bbox: { x: 0.05, y: 0.65, width: 0.9, height: 0.3 }, confidence: 0.97 },
    { id: 'table-3-0', page: 3, markdown: '| Item | Sep 30, 2025 | Dec 31, 2024 |\n|---|---|---|\n| Cash & Equivalents | $8,200M | $6,500M |\n| Accounts Receivable | $2,800M | $2,100M |\n| Total Assets | $45,000M | $38,000M |\n| Total Debt | $5,500M | $6,000M |\n| Shareholders\' Equity | $28,000M | $22,500M |', bbox: { x: 0.05, y: 0.1, width: 0.9, height: 0.4 }, confidence: 0.95 },
  ];

  for (const t of tableDefs) {
    const tableTag = makeTableTag(t.id, t.page, t.markdown, t.bbox, t.confidence);
    tags.push(tableTag);
    if (tableTag.text) {
      tags.push(...expandTableTag(tableTag));
    }
  }

  return tags;
}

function buildInvoiceTags(): Tag[] {
  const tags: Tag[] = [];

  // Extracted entity
  tags.push(
    makeEntityTag('table-1-0', 'table', 1, 'Line Items', { x: 0.05, y: 0.35, width: 0.9, height: 0.35 }, 0.96, { schema: ['Item', 'Description', 'Qty', 'Unit Price', 'Amount'], isComplete: true }),
  );

  // Table markdown + cell expansion
  const tableTag = makeTableTag(
    'table-1-0', 1,
    '| Item | Description | Qty | Unit Price | Amount |\n|---|---|---|---|---|\n| PDF-001 | Document Processing API - Standard | 1,000 | $0.05 | $50.00 |\n| PDF-002 | Table Extraction Add-on | 500 | $0.08 | $40.00 |\n| PDF-003 | Priority Support (Monthly) | 1 | $99.00 | $99.00 |\n| | | | Subtotal | $189.00 |\n| | | | Tax (8.5%) | $16.07 |\n| | | | **Total** | **$205.07** |',
    { x: 0.05, y: 0.35, width: 0.9, height: 0.35 },
    0.96,
  );
  tags.push(tableTag);
  if (tableTag.text) {
    tags.push(...expandTableTag(tableTag));
  }

  // Field entities (enriched to auto-detect currency/date)
  const fields: Tag[] = [
    makeFieldTag('field-invoice-number', 1, 'Invoice Number', 'INV-2025-0042', { x: 0.7, y: 0.1, width: 0.2, height: 0.03 }, 0.99),
    makeFieldTag('field-invoice-date', 1, 'Invoice Date', '2025-01-15', { x: 0.7, y: 0.14, width: 0.2, height: 0.03 }, 0.98),
    makeFieldTag('field-due-date', 1, 'Due Date', '2025-02-14', { x: 0.7, y: 0.18, width: 0.2, height: 0.03 }, 0.97),
    makeFieldTag('field-total', 1, 'Total', '$205.07', { x: 0.75, y: 0.68, width: 0.15, height: 0.03 }, 0.98, 205.07),
  ];
  for (const f of fields) {
    tags.push(enrichTag(f));
  }

  return tags;
}

const financialReportFixture: FixtureData = {
  metadata: {
    documentId: 'sample-financial-report',
    fileName: 'Q3-2025-Earnings.pdf',
    totalPages: 3,
    documentType: 'financial_report',
  },
  tags: buildFinancialReportTags(),
};

const invoiceFixture: FixtureData = {
  metadata: {
    documentId: 'sample-invoice',
    fileName: 'INV-2025-0042.pdf',
    totalPages: 1,
    documentType: 'invoice',
  },
  tags: buildInvoiceTags(),
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
 * Load fixture data as Tag[].
 *
 * @example
 * import { loadFixtureTags, pdfquery } from 'pdfquery';
 *
 * const tags = loadFixtureTags('financial-report');
 * const session = pdfquery.ready({ tags });
 * session.$('.table').count();
 */
export function loadFixtureTags(name: FixtureName): Tag[] {
  return getFixture(name).tags;
}

/**
 * Load a fixture as a PDFQuerySession.
 *
 * @example
 * import { loadFixture } from 'pdfquery';
 *
 * const session = loadFixture('financial-report');
 * session.$('.table').count();  // 4
 */
export function loadFixture(name: FixtureName): PDFQuerySession {
  const tags = loadFixtureTags(name);
  return pdfquery.ready({ tags });
}

/**
 * Compile custom fixture data into a PDFQuerySession.
 */
export function compileFixture(data: FixtureData): PDFQuerySession {
  return pdfquery.ready({ tags: data.tags });
}
