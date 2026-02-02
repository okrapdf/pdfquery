# pdfquery

jQuery for PDFs. CSS selectors and vision models on any PDF.

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

### 2. Deferred extraction -- only parse what you query

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
