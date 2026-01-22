# pdfquery

jQuery for PDFs. Query extracted document entities with CSS-like selectors.

[**Live Demo / Inspector**](https://okrapdf.com/demo/inspector)

```bash
npm install pdfquery
```

## What This Is (and Isn't)

**pdfquery does NOT parse PDFs.** It takes the **output** of any document processing service and makes it queryable:

```
PDF → [Document Processor] → bboxes + text + metadata → pdfquery → queryable DOM
              ↑
      (partitioner, parser, processor, analyzer)
      Unstructured, Docling, LlamaParse,
      Google DocAI, Azure, Textract, etc.
```

Think of pdfquery as a **conceptual port of jQuery**. Same syntax patterns, completely different data structure.

### How Close to jQuery?

| Feature | jQuery | pdfquery |
|---------|--------|----------|
| **The "$"** | `$('.class')` selects HTML elements | `$$('.table')` selects OCR-detected entities |
| **Traversal** | Browser DOM (tags, IDs, classes) | Virtual Doc (tables, figures, fields) |
| **Purpose** | DOM manipulation (hide, show, append) | **Data extraction** (sum, avg, count) |
| **Selectors** | CSS levels 1-3 | CSS-like + data filters like `[confidence>0.9]` |

**Key difference:** jQuery changes how a webpage *looks*. pdfquery extracts information from documents already processed by AI.

### Syntax Mapping from jQuery

| jQuery | pdfquery | Notes |
|--------|----------|-------|
| `.val()` | `.text()` / `.values()` | `.values()` strips currency symbols → numbers |
| `.each(fn)` | `.texts()` | Returns array directly |
| `.find()` | `.filter()` | Same concept |
| — | `.sum()`, `.avg()`, `.stats()` | Aggregation methods jQuery doesn't have |

### Where pdfquery Sits in the Pipeline

```
┌─────────────┐     ┌──────────────────────┐     ┌───────────┐
│   PDF/IMG   │ ──▶ │  Document Processor  │ ──▶ │ pdfquery  │
│  (raw file) │     │  (layout + extract)  │     │ (query)   │
└─────────────┘     └──────────────────────┘     └───────────┘
                              │
                Outputs structured elements:
                bboxes + text + confidence
```

pdfquery consumes the **output** of document processing services. You need one of these first:

| Service | Class/Method | Bbox Field | Normalization |
|---------|--------------|------------|---------------|
| **Unstructured** | `partition()` → `Element.metadata.coordinates` | `CoordinatesMetadata.points` (tuple of x,y) | Divide by `system.layout_width/height` |
| **Docling** | `DoclingDocument` → `item.prov[].bbox` | `BoundingBox(l, t, r, b, coord_origin)` | Already normalized or use `coord_origin` |
| **Google DocAI** | `Document.pages[].blocks[]` | `boundingPoly.normalizedVertices[].x/y` | Already 0-1 normalized |
| **Azure DocIntel** | `AnalyzeResult.documents[].fields[]` | `BoundingRegion.polygon` (list of Points) | Divide by page `width/height` |
| **AWS Textract** | `AnalyzeDocumentResponse.Blocks[]` | `Geometry.BoundingBox.Left/Top/Width/Height` | Already 0-1 normalized |
| **Tesseract** | `pytesseract.image_to_data()` | `left, top, width, height` (pixels) | Divide by image dimensions |

### Example: Normalizing Vendor Output

```typescript
// AWS Textract (already normalized 0-1)
const textractBlock = { Geometry: { BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.05 }}};
const bbox = {
  x: textractBlock.Geometry.BoundingBox.Left,       // 0.1
  y: textractBlock.Geometry.BoundingBox.Top,        // 0.2  
  width: textractBlock.Geometry.BoundingBox.Width,  // 0.3
  height: textractBlock.Geometry.BoundingBox.Height // 0.05
};

// Tesseract (pixels → normalize by dividing by image size)
const tesseractWord = { left: 100, top: 200, width: 150, height: 30 };
const imageSize = { width: 1000, height: 1400 };
const bbox = {
  x: tesseractWord.left / imageSize.width,      // 0.1
  y: tesseractWord.top / imageSize.height,      // 0.143
  width: tesseractWord.width / imageSize.width, // 0.15
  height: tesseractWord.height / imageSize.height // 0.021
};

// Google DocAI (normalizedVertices already 0-1)
const docaiBlock = { boundingPoly: { normalizedVertices: [{x:0.1,y:0.2}, {x:0.4,y:0.2}, {x:0.4,y:0.25}, {x:0.1,y:0.25}]}};
const v = docaiBlock.boundingPoly.normalizedVertices;
const bbox = { x: v[0].x, y: v[0].y, width: v[1].x - v[0].x, height: v[2].y - v[0].y };
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

## Multi-Layer Builder Pattern

pdfquery merges **multiple extraction layers** into one queryable DOM. Each layer can come from a different OCR/VLM service:

```typescript
const compiler = new DocCompiler({ documentId: 'doc' });

// Layer 1: Raw OCR blocks (word/line level from Tesseract, Google DocAI)
compiler.addOcrBlocks([
  { id: 'ocr-1', page: 1, text: 'Revenue', bbox: { x: 0.1, y: 0.2, width: 0.15, height: 0.03 }, confidence: 0.99 },
  { id: 'ocr-2', page: 1, text: '$12.5B', bbox: { x: 0.3, y: 0.2, width: 0.1, height: 0.03 }, confidence: 0.97 },
]);

// Layer 2: Tables (from table extraction model)
compiler.addTables([
  { id: 't1', page_number: 1, markdown: '| Revenue | $12.5B |', bbox: { xmin: 0.05, ymin: 0.15, xmax: 0.95, ymax: 0.5 }, confidence: 0.95 }
]);

// Layer 3: Semantic entities (figures, footnotes from VLM)
compiler.addExtractedEntities([
  { id: 'fig-1', type: 'figure', title: 'Revenue Chart', page: 1, bbox: { x: 0.1, y: 0.6, width: 0.8, height: 0.3 }, confidence: 0.92 }
]);

// Compile all layers → one DOM
const doc = compiler.compile();
const $$ = createQueryEngine(doc);

// Query across all layers
$$('.table').count();        // tables
$$('span.ocr-block').count(); // raw OCR
$$('.figure').count();       // figures
$$('*').onPage(1).count();   // everything on page 1
```

| Method | Layer Type | Granularity |
|--------|-----------|-------------|
| `addOcrBlocks()` | Raw OCR | Word/line bboxes |
| `addTables()` | Tables | Table bbox + markdown |
| `addEntities()` | Fields | Key-value pairs |
| `addExtractedEntities()` | Semantic | Figures, footnotes, summaries |
| `addMarkdownBlocks()` | VLM output | Full-page markdown |

This is the "hydration" model — each layer enriches the same coordinate system.

## License

MIT
