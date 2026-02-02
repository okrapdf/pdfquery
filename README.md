# pdfquery

jQuery for PDFs. CSS selectors and vision models on any PDF.

```bash
npm install pdfquery @okrapdf/pdfquery-plugins
```

---

### Stack plugins, query once

Local OCR runs at load. Cloud extraction and VLM are on-demand. Same `$()` for everything.

```ts
import pdfquery from 'pdfquery';
import { pymupdf, llamaParse, vlmOpenRouter } from '@okrapdf/pdfquery-plugins';

const pdf = { type: 'path', path: './10k.pdf' } as const;

const doc = await pdfquery.load([
  pymupdf({ pdf, extractImages: true }),   // local — runs immediately, produces tags
  llamaParse({ pdf, defer: true }),         // cloud — waits until you call .markdown()
  vlmOpenRouter(),                          // VLM  — waits until you call .vlm()
]);

const $ = doc.$;
```

pymupdf already extracted everything. Selectors, text search, and aggregation work instantly:

```ts
$('table').count();                        // 12 tables found locally
$('ocr').contains('revenue').texts();      // text search across all pages
$('[confidence>0.9]').count();             // filter by OCR confidence
$('*').onPage(1).countByType();            // Map { ocr: 45, table: 2, heading: 3 }
```

Need rich markdown for a specific page? `.markdown()` triggers LlamaParse -- only for the pages you selected:

```ts
const md = await $('table').onPage(6).markdown();   // uploads + parses page 6
const md2 = await $('table').onPage(6).markdown();  // cache hit, no API call
```

Need visual understanding? `.vlm()` sends the cropped page image to a vision model:

```ts
await $('table').onPage(6).vlm('what are the column headers?');
await $('figure').eq(0).css({ margin: 20 }).vlm('describe this chart');
await $('page:first').vlm('summarize this page in 2 sentences');
```

One query interface. Three backends. You only pay for what you use.

---

## Plugins

| Plugin | What it does | API key |
|--------|-------------|---------|
| `pymupdf` | Local text + table extraction, page rasterization | No |
| `llamaParse` | LlamaIndex Cloud extraction (eager or `defer: true`) | `LLAMAINDEX_API_KEY` |
| `vlmOpenRouter` | `.vlm()` on any element via OpenRouter | `OPENROUTER_API_KEY` |
| `vlmBboxDetect` | VLM visual entity detection (tables/figures the OCR missed) | Uses vlmOpenRouter |
| `doclingServe` | IBM Docling (self-hosted) | No |
| `googleOcr` | Google Document AI | GCP credentials |

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
