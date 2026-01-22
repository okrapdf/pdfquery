# pdfquery

jQuery for PDFs. Query extracted document entities with CSS-like selectors.

[**Live Demo / Inspector**](https://okrapdf.com/demo/inspector)

```bash
npm install pdfquery
```

## What This Is (and Isn't)

**pdfquery does NOT parse PDFs.** It takes the **output** of any OCR/VLM service and makes it queryable:

```
PDF → [OCR Service] → bboxes + text → pdfquery → queryable DOM
         ↑
   Google DocAI, Azure Form Recognizer,
   AWS Textract, LlamaParse, Tesseract, etc.
```

### Input Format

pdfquery accepts JSON with:
- **Bounding boxes**: Normalized 0-1 coordinates (`{x, y, width, height}` or `{xmin, ymin, xmax, ymax}`)
- **Text content**: The extracted text
- **Entity metadata**: Type, confidence score, verification status

```typescript
// Example: what OCR services output → what pdfquery consumes
{
  tables: [{
    id: "table-1",
    page_number: 1,
    markdown: "| Revenue | $12.5B |\n|---|---|",
    bbox: { xmin: 0.05, ymin: 0.15, xmax: 0.95, ymax: 0.5 },  // normalized 0-1
    confidence: 0.98
  }],
  entities: [{
    id: "field-total",
    page_number: 1,
    field_label: "Total",
    suggested_value: "$205.07",
    bounding_box: { x: 0.75, y: 0.68, width: 0.15, height: 0.03 },
    confidence: 0.98
  }]
}
```

## Quick Start (No API Key Needed)

```typescript
import { loadFixture, createQueryEngine } from 'pdfquery';

// Load sample data (financial report or invoice)
const doc = loadFixture('financial-report');
const $$ = createQueryEngine(doc);

// Query like jQuery
$$('.table').count();           // 4 tables
$$('.currency').sum();          // aggregate values
$$('[confidence>0.9]').texts(); // high-confidence extractions
```

Available fixtures: `'financial-report'`, `'invoice'`

## Usage with Your Own Data

```typescript
import { DocCompiler, createQueryEngine } from 'pdfquery';

// Your OCR output (from any service)
const ocrOutput = {
  tables: [{ id: 't1', page_number: 1, markdown: '...', bbox: {...}, confidence: 0.95 }],
  entities: [{ id: 'e1', page_number: 1, suggested_value: '$100', bounding_box: {...} }]
};

// Compile into queryable DOM
const compiler = new DocCompiler({ documentId: 'my-doc' });
compiler.addTables(ocrOutput.tables);
compiler.addEntities(ocrOutput.entities);
const doc = compiler.compile();

// Query
const $$ = createQueryEngine(doc);
$$('.table').stats();
```

## Selectors

| Selector | Description |
|----------|-------------|
| `*` | All entities |
| `.table` | Tables |
| `.figure` | Figures/charts |
| `.currency` | Currency values |
| `.percentage` | Percentages |
| `.date` | Dates |
| `.footnote` | Footnotes |
| `#entity_id` | By ID |
| `[attr=value]` | Attribute equals |
| `[attr>value]` | Attribute greater than |
| `[confidence>0.9]` | High confidence |
| `:contains(text)` | Text search |
| `:page(5)` | On specific page |
| `:pages(1-10)` | Page range |
| `:first` | First match |
| `:last` | Last match |

## Methods

### Filtering
- `.filter(selector)` - Filter by selector or predicate
- `.not(selector)` - Exclude matches
- `.contains(text)` - Text search
- `.matches(regex)` - Regex match
- `.onPage(n)` - Filter to page
- `.take(n)` / `.skip(n)` - Limit results

### Data Access
- `.text()` - Get text of first element
- `.texts()` - Get all texts as array
- `.values()` - Get parsed numeric values
- `.attr(key)` - Get attribute
- `.attr(key, value)` - Set attribute
- `.data(key)` - Get/set arbitrary data

### Aggregation
- `.stats()` - Verification statistics
- `.sum()` / `.avg()` / `.min()` / `.max()` - Numeric aggregation
- `.count()` - Count entities
- `.countByType()` - Count by entity type
- `.countByPage()` - Count by page

### Grouping
- `.groupBy(fn)` - Group by key function
- `.groupByPage()` - Group by page number
- `.groupByType()` - Group by entity type

### Rendering
- `.html()` - Render as HTML
- `.htmlDocument()` - Full HTML document
- `.json()` - JSON string

## Bringing Your Own OCR

pdfquery is **OCR-agnostic**. Normalize your OCR output to this shape:

```typescript
interface SourceTable {
  id: string;
  page_number: number;
  markdown: string;                           // table content
  bbox: { xmin, ymin, xmax, ymax: number };   // normalized 0-1
  confidence?: number;
}

interface SourceEntity {
  id: string;
  page_number: number;
  field_label?: string;
  suggested_value: string;
  suggested_value_numeric?: number;
  bounding_box: { x, y, width, height: number };  // normalized 0-1
  confidence: number;
}
```

Then compile:
```typescript
const compiler = new DocCompiler({ documentId: 'doc' });
compiler.addTables(yourTables);
compiler.addEntities(yourEntities);
const doc = compiler.compile();
```

## License

MIT
