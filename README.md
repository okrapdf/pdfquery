# pdfquery

jQuery for PDFs. Query extracted document entities with CSS-like selectors.

```bash
npm install pdfquery
```

## What This Is (and Isn't)

**pdfquery does NOT parse PDFs.** It takes the **output** of any document processing service and makes it queryable:

```
PDF → [Document Processor] → bboxes + text + metadata → pdfquery → queryable DOM
              ↑
      Unstructured, Docling, LlamaParse,
      Google DocAI, Azure, Textract, etc.
```

Think of pdfquery as a **conceptual port of jQuery**. Same syntax patterns, completely different data structure.

| Feature | jQuery | pdfquery |
|---------|--------|----------|
| **The "$"** | `$('.class')` selects HTML elements | `$('.table')` selects OCR-detected entities |
| **Traversal** | Browser DOM (tags, IDs, classes) | Virtual Doc (tables, figures, fields) |
| **Purpose** | DOM manipulation (hide, show, append) | **Data extraction** (sum, avg, count) |
| **Selectors** | CSS levels 1-3 | CSS-like + data filters like `[confidence>0.9]` |

**Key difference:** jQuery changes how a webpage *looks*. pdfquery extracts information from documents already processed by AI.

## Quick Start

No API key needed — built-in fixtures included:

```typescript
import { loadFixture } from 'pdfquery';

const doc = loadFixture('financial-report');

doc.$('.table').count();           // 4 tables
doc.$('.currency').sum();          // aggregate values
doc.$('[confidence>0.9]').texts(); // high-confidence extractions
```

Available fixtures: `'financial-report'`, `'invoice'`

## Usage with Your Own Data

pdfquery works with **Tags** — a simple, vendor-agnostic format:

```typescript
import { pdfquery } from 'pdfquery';

const session = pdfquery.ready({
  tags: [
    {
      id: 'table-1',
      type: 'table',
      page: 1,
      bbox: { x: 0.05, y: 0.15, width: 0.9, height: 0.35 },
      text: '| Revenue | $12.5B |\n|---|---|\n| Expenses | $8.2B |',
      attrs: { confidence: 0.98 },
    },
    {
      id: 'field-total',
      type: 'currency',
      page: 1,
      bbox: { x: 0.75, y: 0.68, width: 0.15, height: 0.03 },
      text: '$205.07',
      attrs: { confidence: 0.95, value: 205.07 },
    },
  ],
});

session.$('.table').count();      // 1
session.$('.currency').sum();     // 205.07
```

## Vendor Adapters

pdfquery ships adapters that convert vendor-specific output into Tags automatically:

```typescript
import { pdfquery, fromUnstructured, fromDocling, fromTextract } from 'pdfquery';

// Unstructured
const { blocks, tables } = fromUnstructured(unstructuredElements);

// Docling (IBM)
const { blocks, tables } = fromDocling(doclingDocument);

// AWS Textract
const { blocks, tables } = fromTextract(textractResponse);

// Google Document AI
import { fromDocAI } from 'pdfquery';
const { blocks, tables } = fromDocAI(docaiDocument);

// Azure Document Intelligence
import { fromAzure } from 'pdfquery';
const { blocks, tables } = fromAzure(azureResult);

// Tesseract
import { fromPytesseract, fromTesseractJs } from 'pdfquery';
const { blocks } = fromPytesseract(tesseractData, { width: 612, height: 792 });
```

All adapters normalize bounding boxes to 0-1 coordinates and return an `AdapterResult`:

```typescript
interface AdapterResult {
  blocks: NormalizedBlock[];  // text blocks with normalized bboxes
  tables: NormalizedTable[];  // tables with markdown + normalized bboxes
  pageCount: number;
}
```

## Event-Driven Usage

pdfquery supports reactive data flow — add tags incrementally and listen for updates:

```typescript
import { pdfquery } from 'pdfquery';

const doc = pdfquery();

// Listen for data
doc.on('tags', ($) => {
  console.log('Tables found:', $('.table').count());
});

// Feed data as it arrives (e.g., from a streaming OCR pipeline)
doc.addTags(firstBatch);
doc.addTags(secondBatch);
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

### Spatial
- `.near(selector, distance)` - Entities near another
- `.above(selector)` - Entities above another
- `.below(selector)` - Entities below another
- `.leftOf(selector)` - Entities left of another
- `.rightOf(selector)` - Entities right of another
- `.within(bbox)` - Entities within a bounding box

### Data Access
- `.text()` - Get text of first element
- `.texts()` - Get all texts as array
- `.values()` - Get parsed numeric values
- `.attr(key)` - Get attribute
- `.attr(key, value)` - Set attribute

### Aggregation
- `.sum()` / `.avg()` / `.min()` / `.max()` - Numeric aggregation
- `.count()` - Count entities
- `.stats()` - Verification statistics
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

## Plugins

Extend pdfquery with plugins for custom processing:

```typescript
import { pdfquery, registerPlugin } from 'pdfquery';

registerPlugin({
  name: 'my-enricher',
  run: async ({ $, emit, artifacts }) => {
    // Process entities, emit events, store results
    return { tags: [] }; // optionally return new tags
  },
});
```

## Where pdfquery Sits in the Pipeline

| Service | Adapter |
|---------|---------|
| **Unstructured** | `fromUnstructured()` |
| **Docling** | `fromDocling()` |
| **Google DocAI** | `fromDocAI()` |
| **Azure DocIntel** | `fromAzure()` |
| **AWS Textract** | `fromTextract()` |
| **Tesseract** | `fromPytesseract()` / `fromTesseractJs()` |

## License

MIT
