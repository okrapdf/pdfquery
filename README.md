# pdfquery

A DOM for PDFs. Load a PDF, query it with selectors, ask a VLM about any element.

```bash
npm install pdfquery
```

## The Idea

```ts
const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './10k.pdf' }, extractImages: true }),
  vlmOpenRouter(),
]);

const $ = doc.$;

$('page:first').vlm('what is this page about?');
$('table').onPage(6).vlm('extract all dollar amounts');
$('ocr').contains('revenue').eq(0).vlm('what revenue figure is shown here?');
```

No intermediate HTML. No markdown conversion step. You go straight from PDF to queryable DOM, and any element can talk to a vision model.

## How It Works

pdfquery is a document DOM with a plugin system. Plugins handle I/O (PDF parsing, OCR, VLM calls). The core handles the query engine, spatial math, and tag tree.

```
PDF file
  |  pymupdf plugin (local, no API)
  v
Tags: ocr blocks, tables, figures -- each with a 0-1 normalized bbox
  |  vlmOpenRouter plugin (sets up VLM handler)
  v
Queryable DOM -- $('table').vlm('summarize'), $('page:first').text(), etc.
  |  vlmBboxDetect plugin (optional, asks VLM to find entities by sight)
  v
More tags: VLM-detected tables/figures with bboxes overlaid
```

Plugins are composable. Use one, use all, bring your own:

```ts
// Local only, no API keys
pdfquery.load([ pymupdf({ pdf: { type: 'path', path: './report.pdf' } }) ]);

// Local extraction + VLM queries
pdfquery.load([ pymupdf({ pdf, extractImages: true }), vlmOpenRouter() ]);

// Cloud OCR
pdfquery.load([ llamaParse({ pdf }) ]);

// VLM visual entity detection (finds tables/figures the OCR missed)
pdfquery.load([ pymupdf({ pdf, extractImages: true }), vlmOpenRouter(), vlmBboxDetect({ types: ['table', 'figure'] }) ]);
```

## Plugins

The plugin package lives at `pdfquery-plugins/` in this repo (`@okrapdf/pdfquery-plugins`).

| Plugin | What it does | Needs API key |
|--------|-------------|---------------|
| `pymupdf` | Local PDF text + table extraction, optional page rasterization | No |
| `vlmOpenRouter` | Vision model queries via OpenRouter (`.vlm()` on any element) | `OPENROUTER_API_KEY` |
| `vlmBboxDetect` | Ask VLM to visually detect tables/figures and return bboxes | Uses vlmOpenRouter |
| `llamaParse` | LlamaIndex Cloud extraction | `LLAMAINDEX_API_KEY` |
| `googleOcr` | Google Document AI | GCP credentials |
| `doclingServe` | IBM Docling local server | No (self-hosted) |
| `serializeHtml` | Render tag tree as inspectable HTML | No |
| `pageIndex` | Page-level indexing for fast lookups | No |

Default VLM model: `qwen/qwen3-vl-235b-a22b-instruct` (Qwen3 VL 235B via OpenRouter).

## Bounding Box Convention

Follows the same convention as [okrapdf](https://github.com/okrapdf/okrapdf):

| Layer | Scale | Format |
|-------|-------|--------|
| VLM output (Qwen VL) | 0-1000 integers | `[x1, y1, x2, y2]` |
| Plugin boundary | normalizes to 0-1 | `normalizeBbox()` from core |
| Tag storage | 0-1 | `{ x, y, width, height }` |

The core exports `normalizeBbox()` and `clampBbox()`. Plugins call these at the boundary -- the core owns the contract, plugins handle the conversion.

```ts
import { normalizeBbox, clampBbox } from 'pdfquery';

// Qwen VL returns [x1, y1, x2, y2] in 0-1000
normalizeBbox([102, 205, 943, 588]);
// → { x: 0.102, y: 0.205, width: 0.841, height: 0.383 }

// Auto-detects 0-1000 objects too
normalizeBbox({ x: 102, y: 205, width: 841, height: 383 });
// → { x: 0.102, y: 0.205, width: 0.841, height: 0.383 }

// Already 0-1? Passes through
normalizeBbox({ x: 0.1, y: 0.2, width: 0.8, height: 0.4 });
// → { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }
```

## Selectors

| Selector | Example |
|----------|---------|
| Type | `$('table')`, `$('figure')`, `$('ocr')` |
| Pseudo | `$('page:first')`, `$(':last')`, `$(':page(5)')`, `$(':pages(1-10)')` |
| Attribute | `$('[confidence>0.9]')`, `$('[source=vlm-bbox]')` |
| Text | `$(':contains(revenue)')` |
| ID | `$('#entity-id')` |
| Universal | `$('*')` |

## Methods

**Filtering**: `.filter()`, `.not()`, `.contains()`, `.matches()`, `.onPage()`, `.eq()`, `.take()`, `.skip()`

**Data**: `.text()`, `.texts()`, `.values()`, `.attr()`, `.data()`, `.first()`, `.last()`

**Aggregation**: `.count()`, `.sum()`, `.avg()`, `.min()`, `.max()`, `.stats()`, `.countByType()`, `.countByPage()`

**Grouping**: `.groupBy()`, `.groupByPage()`, `.groupByType()`

**AI**: `.vlm(prompt)` -- ask a vision model about the selected elements. `.markdown()` -- VLM-powered markdown extraction.

**Rendering**: `.html()`, `.htmlDocument()`, `.json()`

**Spatial**: `.near()` -- find entities near the selection by distance threshold.

**Styling**: `.css()` -- attach render styles (used by overlay scripts for bbox visualization).

## Quick Start (No API Key)

```ts
import { pdfquery, loadFixture, createQueryEngine } from 'pdfquery';

const doc = loadFixture('financial-report');
const $$ = createQueryEngine(doc);

$$('.table').count();           // 4 tables
$$('.currency').sum();          // aggregate values
$$('[confidence>0.9]').texts(); // high-confidence extractions
```

## Quick Start (With PDF)

```ts
import pdfquery from 'pdfquery';
import { pymupdf, vlmOpenRouter } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './report.pdf' }, extractImages: true }),
  vlmOpenRouter(),
]);

const $ = doc.$;

// Count what was extracted
console.log($('*').count(), 'entities');
console.log($('table').count(), 'tables');

// Ask the VLM about page 1
const summary = await $('page:first').vlm('summarize this page in 2 sentences');

// Find revenue figures
const rev = await $('ocr').contains('revenue').eq(0).vlm('what is the exact revenue figure?');
```

## Tag Model

Everything is a `Tag`. Tags have a type, page number, bbox, and optional text/attributes:

```ts
interface Tag {
  id: string;
  type: string;           // 'table', 'figure', 'ocr', 'heading', ...
  page: number;           // 1-indexed
  bbox: BBox;             // { x, y, width, height } normalized 0-1
  text?: string;
  attrs?: Record<string, unknown>;
}
```

The tag tree is built by bbox containment -- a table contains its OCR blocks because its bbox encloses theirs. Same spatial nesting as a real DOM.

## Events

Plugins emit events you can listen to:

```ts
const session = pdfquery();
session.use(pymupdf({ pdf, extractImages: true }));
session.use(vlmOpenRouter());
session.use(vlmBboxDetect({ types: ['table', 'figure'] }));

session.on('vlm-bbox-detect:page-start', (_, d) => console.log(`detecting page ${d.page}...`));
session.on('vlm-bbox-detect:page-done', (_, d) => console.log(`page ${d.page} done in ${d.ms}ms`));
session.on('vlm-bbox-detect:raw', (_, d) => console.log('raw VLM response:', d.response));

const doc = await session.load();
```

## Vendor Adapters

If you already have OCR output from another service, pdfquery has adapters to normalize it into Tags:

```ts
import { adapters } from 'pdfquery';

// Unstructured, Google DocAI, LlamaParse, Docling, Azure, Textract
const tags = adapters.unstructured(unstructuredOutput);
const tags = adapters.googleDocai(docaiOutput);
```

Or bring raw JSON -- any `{ id, type, page, bbox, text }` array works as Tags directly.

## License

MIT
