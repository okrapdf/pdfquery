/**
 * Tag Utilities
 *
 * Reusable enrichment logic for Tags: type detection, value parsing,
 * markdown table expansion. These are the pure functions that DocCompiler
 * used to own, now available for any Tag-based pipeline.
 */

import type { Tag, BBox } from './tag';

// ============================================================================
// Entity Type Detection
// ============================================================================

const CURRENCY_PATTERN = /^[\$£€¥]?\s*-?[\d,]+\.?\d*\s*(?:万|亿|千)?$/;
const PERCENTAGE_PATTERN = /^-?\d+\.?\d*\s*%$/;
const DATE_PATTERN = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$|^\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}$/;
const NUMBER_PATTERN = /^-?[\d,]+\.?\d*$/;

/**
 * Detect a semantic entity type from raw text and an optional label hint.
 *
 * Returns a type string suitable for `Tag.type`. When text doesn't match
 * any known pattern, returns `'text'` (short strings → `'label'`).
 */
export function detectEntityType(text: string, label?: string): string {
  const trimmed = text.trim();

  // Label hints take priority
  if (label) {
    const lower = label.toLowerCase();
    if (lower.includes('total')) return 'total';
    if (lower.includes('subtotal')) return 'subtotal';
    if (lower.includes('date')) return 'date';
  }

  if (CURRENCY_PATTERN.test(trimmed)) return 'currency';
  if (PERCENTAGE_PATTERN.test(trimmed)) return 'percentage';
  if (DATE_PATTERN.test(trimmed)) return 'date';
  if (NUMBER_PATTERN.test(trimmed)) return 'number';
  if (trimmed.length < 50 && !trimmed.includes('\n')) return 'label';

  return 'text';
}

// ============================================================================
// Value Parsing
// ============================================================================

/**
 * Extract a numeric value from text based on its type.
 * Percentages are returned as decimals (e.g. "45%" → 0.45).
 */
export function parseValue(text: string, type: string): number | undefined {
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

// ============================================================================
// Markdown Table Parsing
// ============================================================================

interface ParsedTableRow {
  cells: string[];
  isHeader: boolean;
}

interface ParsedTable {
  rows: ParsedTableRow[];
  columnCount: number;
}

/**
 * Parse a markdown table string into rows and cells.
 * Skips separator rows (|---|---|). First data row is treated as header.
 */
export function parseMarkdownTable(markdown: string): ParsedTable {
  const lines = markdown.split('\n').filter(line => line.trim());
  const rows: ParsedTableRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip separator lines
    if (/^\|?\s*[-:]+\s*\|/.test(line)) continue;

    if (line.startsWith('|') || line.includes('|')) {
      const cells = line
        .split('|')
        .map(cell => cell.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      if (cells.length > 0) {
        rows.push({
          cells,
          isHeader: rows.length === 0,
        });
      }
    }
  }

  const columnCount = Math.max(...rows.map(r => r.cells.length), 0);
  return { rows, columnCount };
}

// ============================================================================
// Tag Enrichment
// ============================================================================

/**
 * Auto-detect type and parse numeric value for a tag.
 * Only enriches tags with generic types ('text', 'label', 'unknown', or undefined type match).
 * Returns a new Tag (does not mutate the original).
 */
export function enrichTag(tag: Tag): Tag {
  const text = tag.text ?? '';
  const label = tag.attrs?.fieldLabel as string | undefined;

  // Only auto-detect if type is generic
  const genericTypes = ['text', 'label', 'unknown', 'table_cell'];
  const shouldDetect = genericTypes.includes(tag.type) || !tag.type;

  const detectedType = shouldDetect ? detectEntityType(text, label) : tag.type;
  const value = parseValue(text, detectedType);

  return {
    ...tag,
    type: detectedType,
    attrs: {
      ...tag.attrs,
      ...(value !== undefined && { value }),
    },
  };
}

// ============================================================================
// Table Expansion
// ============================================================================

/**
 * Expand a table tag into individual cell tags.
 *
 * Parses the tag's markdown text content and produces one child tag per
 * non-empty cell. Cell bboxes are approximated by evenly subdividing the
 * table's bbox. Each cell tag gets auto-detected type and parsed value.
 *
 * @param tableTag  A tag whose text contains a markdown table
 * @param options   Optional: autoDetectTypes (default true)
 * @returns Array of cell tags (does NOT include the parent table tag)
 */
export function expandTableTag(
  tableTag: Tag,
  options: { autoDetectTypes?: boolean } = {},
): Tag[] {
  const { autoDetectTypes = true } = options;
  const text = tableTag.text ?? '';
  if (!text) return [];

  const parsed = parseMarkdownTable(text);
  if (parsed.rows.length === 0) return [];

  const { x, y, width, height } = tableTag.bbox;
  const rowHeight = height / parsed.rows.length;
  const colWidth = parsed.columnCount > 0 ? width / parsed.columnCount : width;

  const tags: Tag[] = [];

  for (let rowIdx = 0; rowIdx < parsed.rows.length; rowIdx++) {
    const row = parsed.rows[rowIdx];

    for (let colIdx = 0; colIdx < row.cells.length; colIdx++) {
      const cellText = row.cells[colIdx];
      if (!cellText.trim()) continue;

      const cellBbox: BBox = {
        x: x + colIdx * colWidth,
        y: y + rowIdx * rowHeight,
        width: colWidth,
        height: rowHeight,
      };

      const cellType = row.isHeader
        ? 'header'
        : autoDetectTypes
          ? detectEntityType(cellText)
          : 'table_cell';

      const value = parseValue(cellText, cellType);

      tags.push({
        id: `${tableTag.id}_r${rowIdx}_c${colIdx}`,
        type: cellType,
        page: tableTag.page,
        bbox: cellBbox,
        text: cellText,
        attrs: {
          tableId: tableTag.id,
          rowIndex: rowIdx,
          colIndex: colIdx,
          confidence: (tableTag.attrs?.confidence as number) ?? 0,
          verificationStatus: (tableTag.attrs?.verificationStatus as string) ?? 'pending',
          ...(value !== undefined && { value }),
        },
      });
    }
  }

  return tags;
}
