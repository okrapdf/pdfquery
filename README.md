# pdfquery

jQuery for PDFs. CSS selectors, spatial queries, and vision models -- on any PDF.

```bash
npm install pdfquery @okrapdf/pdfquery-plugins
```

---

### 1. Point a VLM at any element

Load a PDF, select something, ask a vision model about it. The VLM sees the actual rendered pixels, cropped to the element's bounding box.

```ts
import pdfquery from 'pdfquery';
import { pymupdf, vlmOpenRouter } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './10k.pdf' }, extractImages: true }),
  vlmOpenRouter(),
]);

const $ = doc.$;

await $('page:first').vlm('what is this page about?');
await $('table').onPage(6).vlm('extract all dollar amounts');
await $('table').css({ margin: 20 }).vlm('what are the column headers?');
```

`.vlm()` works on any selection. Single element, multi-page, filtered subset. The plugin crops the page image to the union bounding box of whatever you selected, adds optional CSS margin for context, and sends it to the model.

---

### 2. Spatial queries -- find what's next to what

Every entity has a bounding box. You can query by proximity, direction, or region -- the way you'd read a document with your eyes.

```ts
// find the label to the left of each currency value
$('.currency').leftOf({ requireOverlap: true });

// find footnotes below figures
$('.figure').below({ maxDistance: 0.1 });

// find everything near a specific table (within 10% of page)
$('.table:first').near(0.1);

// find entities in the top-right quadrant of page 1
$('*').onPage(1).within({ xmin: 0.5, ymin: 0, xmax: 1, ymax: 0.5 });
```

Combine spatial queries with VLM for things like "read the value to the right of this label":

```ts
const label = $('ocr').contains('Total Revenue').eq(0);
const nearby = label.rightOf({ maxDistance: 0.15, requireOverlap: true });
await nearby.vlm('what is the exact dollar amount?');
```

---

### 3. Deferred extraction -- only parse what you query

With `defer: true`, the plugin registers a handler but doesn't extract anything. Extraction happens when you call `.markdown()` -- only for the pages you selected.

```ts
import pdfquery from 'pdfquery';
import { llamaParse } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  llamaParse({ pdf: { type: 'path', path: './100-page-report.pdf' }, defer: true }),
]);

const $ = doc.$;

// nothing has been parsed yet

const md = await $('page').onPage(6).markdown();  // extracts page 6 only
const md2 = await $('page').onPage(6).markdown(); // cache hit, no API call
```

The handler uploads and parses on first access, caches the result, and injects the extracted tags back into the session. Subsequent queries on the same pages are instant.

---

## Plugins

| Plugin | What it does | API key |
|--------|-------------|---------|
| `pymupdf` | Local PDF text + table extraction, page rasterization | No |
| `vlmOpenRouter` | `.vlm()` on any element via OpenRouter | `OPENROUTER_API_KEY` |
| `vlmBboxDetect` | VLM-powered visual entity detection | Uses vlmOpenRouter |
| `llamaParse` | LlamaIndex Cloud extraction (eager or deferred) | `LLAMAINDEX_API_KEY` |
| `googleOcr` | Google Document AI | GCP credentials |
| `doclingServe` | IBM Docling (self-hosted) | No |

Plugins are composable. Use one or stack them:

```ts
pdfquery.load([ pymupdf({ pdf }) ]);                                         // local only
pdfquery.load([ pymupdf({ pdf, extractImages: true }), vlmOpenRouter() ]);   // local + VLM
pdfquery.load([ llamaParse({ pdf, defer: true }) ]);                         // cloud, on-demand
```

## Quick start (no API key)

```bash
npx tsx examples/basic.ts
```

```ts
import { loadFixture, createQueryEngine } from 'pdfquery';

const $ = createQueryEngine(loadFixture('financial-report').document!);

$('table').count();            // 8
$('table').texts();            // markdown content of each table
$('[confidence>0.95]').count(); // 81
$('*').countByType();          // Map { table: 8, header: 15, ... }
```

## License

MIT
