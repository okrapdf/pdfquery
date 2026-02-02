# @okrapdf/pdfquery-plugins

Data source plugins for pdfquery. A plugin is a factory that returns `PDFQueryPlugin` — it can call a local library, hit a remote API, or wrap pre-cached JSON. As long as it returns `Tag[]`, pdfquery queries it uniformly.

## Install

```bash
pnpm add @okrapdf/pdfquery-plugins
# For pymupdf plugin:
pip install pymupdf
```

## Quick Start

```ts
import pdfquery from 'pdfquery';
import { pymupdf } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './report.pdf' } }),
]);

doc.$('table').count();           // 42
doc.$('ocr').contains('revenue'); // full-text search across OCR blocks
doc.$('heading').texts();         // TOC entries
```

## Plugins

### `pymupdf` — Local PDF extraction (real I/O)

Spawns PyMuPDF (fitz) as a subprocess. Extracts text blocks, tables, TOC, and optionally rasterizes pages for VLM plugins. Zero network calls.

**Requires:** `pip install pymupdf`

```ts
import { pymupdf } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({
    pdf: { type: 'path', path: './10k.pdf' },
    // pdf: { type: 'buffer', data: pdfBytes },  // also accepts buffers
    extractImages: false,   // set true to rasterize pages for VLM
    imagesDpi: 150,
    extractTables: true,
    extractToc: true,
    pythonPath: 'python3',
  }),
]);

// Query
doc.$('table').count();
doc.$('ocr').onPage(5).texts();
doc.$('heading').toArray();       // TOC entries as entities

// Tables per page
const tables = doc.$('table').toArray();
const perPage = new Map<number, number>();
for (const t of tables) {
  const p = t.pageIndex + 1;
  perPage.set(p, (perPage.get(p) || 0) + 1);
}

// Artifacts for downstream plugins
doc.artifacts.get('ocr:pages');   // OcrPage[] — structured blocks per page
doc.artifacts.get('toc:entries'); // TocEntry[] — {level, title, page}
doc.artifacts.get('pages:images');// PageImage[] — if extractImages was true
```

**Produces:**

| Tag type | Source |
|----------|--------|
| `ocr` | Text blocks with normalized 0-1 bboxes |
| `table` | Tables with markdown text + bbox |
| `heading` | TOC entries (from PDF bookmarks or printed TOC) |

**Sets artifacts:**

| Key | Type | Description |
|-----|------|-------------|
| `pdf:input` | `PDFInput` | The input config |
| `ocr:pages` | `OcrPage[]` | Structured blocks per page |
| `toc:entries` | `TocEntry[]` | TOC entries with level/title/page |
| `pages:images` | `PageImage[]` | Rasterized PNGs (only if `extractImages: true`) |

### `googleOcr` — Google Document AI (skeleton)

Factory for Google Document AI. Skeleton — correct interface and artifact contracts, no real I/O. Override `run` or use `fromDocAIPlugin` for pre-cached results.

```ts
import { googleOcr } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  googleOcr({ pdf: { type: 'path', path: './doc.pdf' } }),
]);
```

### `vlmEntityDetect` — VLM entity detection (skeleton)

Reads `pages:images` from artifacts (set by OCR plugin), detects tables/figures/footnotes. Skeleton implementation.

```ts
import { pymupdf, vlmEntityDetect } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './doc.pdf' }, extractImages: true }),
  vlmEntityDetect({ apiKey: '...' }),
]);
```

### `vlmMarkdown` — VLM markdown extraction (skeleton)

Reads `pages:images` + `ocr:pages`, produces structured markdown per page. Skeleton implementation.

### `vlmOpenRouter` — Vision model queries via OpenRouter

Ask questions about any page, table, or element using a vision language model. The plugin registers a `vlm:call` handler; `QueryResult.vlm(prompt)` sends the relevant page images + your prompt to the model and returns the answer.

**Requires:** `OPENROUTER_API_KEY` env var (or pass `apiKey` in config)

```ts
import pdfquery from 'pdfquery';
import { pymupdf, vlmOpenRouter } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './10k.pdf' }, extractImages: true }),
  vlmOpenRouter(),  // reads OPENROUTER_API_KEY from env
]);

// Ask about the first page
await doc.$('page:first').vlm('What is this page about?');
// → "This is the cover page of NVIDIA's Form 10-Q for the period ended..."

// Extract data from tables
await doc.$('table').onPage(3).vlm('List all dollar amounts in this table.');
// → "$57,006\n$15,157\n$41,849\n..."

// Targeted queries — VLM sees only the pages your selection lives on
await doc.$('ocr').contains('revenue').eq(0).vlm('What revenue figure is shown here?');
// → "The revenue for the latest quarter is $57,006 million."

// Multi-page queries
await doc.$('table').vlm('Which tables contain financial statements?');
```

**Config:**

```ts
vlmOpenRouter({
  apiKey: '...',                                   // default: process.env.OPENROUTER_API_KEY
  model: 'qwen/qwen3-vl-235b-a22b-instruct',      // default
  maxTokens: 2048,                                 // default
})
```

**How it works:**

1. `pymupdf({ extractImages: true })` rasterizes each page to PNG and stores them in the `pages:images` artifact
2. `vlmOpenRouter()` registers a `vlm:call` handler on artifacts
3. When you call `$('table').onPage(3).vlm('...')`, pdfquery:
   - Collects the unique page indices from your selected elements
   - Grabs the corresponding page images from `pages:images`
   - Sends them + your prompt to the VLM via OpenRouter
   - Returns the model's text response

**Important:** `extractImages: true` is required on your source plugin. Without page images, `.vlm()` throws.

### `llamaParse` — LlamaIndex Cloud API

Upload PDF → poll → get structured JSON with layout bounding boxes. Produces `ocr` + `table` + `figure` tags.

**Requires:** `LLAMAINDEX_API_KEY` env var

```ts
import { llamaParse } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  llamaParse({ pdf: { type: 'path', path: './report.pdf' } }),
]);
doc.$('table').count();
doc.$('ocr').contains('revenue').texts();
```

**Config:**
```ts
llamaParse({
  pdf: { type: 'path', path: './doc.pdf' },
  apiKey: '...',                         // default: process.env.LLAMAINDEX_API_KEY
  apiBase: 'https://api.cloud.llamaindex.ai',  // default
  resultType: 'json',                    // 'json' (bboxes) or 'markdown' (text only)
  targetPages: '1,3,5-10',              // optional page filter
  pollIntervalMs: 2000,
  timeoutMs: 300000,
})
```

### `okraOcr` — OkraPDF API

Extract via OkraPDF's own OCR pipeline. Supports URL, file path, or buffer input.

**Requires:** `OKRAPDF_API_KEY` env var (optional for public URLs)

```ts
import { okraOcr } from '@okrapdf/pdfquery-plugins';

// From URL (simplest)
const doc = await pdfquery.load([
  okraOcr({ pdf: { type: 'url', url: 'https://example.com/report.pdf' } }),
]);

// From local file
const doc = await pdfquery.load([
  okraOcr({ pdf: { type: 'path', path: './report.pdf' } }),
]);
```

### `doclingServe` — IBM Docling (self-hosted)

Send PDF to a self-hosted [docling-serve](https://github.com/DS4SD/docling-serve) instance. Uses the existing `fromDocling` adapter for normalization — full bbox support with coordinate origin handling.

**Requires:** `pip install "docling-serve[ui]" && docling-serve run`

```ts
import { doclingServe } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  doclingServe({
    pdf: { type: 'path', path: './report.pdf' },
    apiBase: 'http://localhost:5001',  // default
  }),
]);
doc.$('table').count();
doc.$('figure').count();  // Docling detects figures too
```

### `pageIndex` — PageIndex AI

Reasoning-based RAG with hierarchical tree indexing. Returns structure-preserving content with page references. Stores the raw tree in `pageindex:tree` artifact.

**Requires:** `PAGEINDEX_API_KEY` env var

```ts
import { pageIndex } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pageIndex({ pdf: { type: 'path', path: './report.pdf' } }),
]);
doc.$('ocr').contains('revenue').texts();
doc.artifacts.get('pageindex:tree');  // raw tree structure
```

### Adapter bridges — wrap existing vendor output

Wrap already-parsed vendor adapter output as plugins. Same query interface, no re-processing.

```ts
import { fromDocAI } from 'pdfquery';  // vendor adapter
import { fromDocAIPlugin } from '@okrapdf/pdfquery-plugins';

// Parse vendor JSON once, wrap as plugin
const adapterResult = fromDocAI(cachedDocAIJson);
const doc = await pdfquery.load([fromDocAIPlugin(adapterResult)]);
doc.$('table').count(); // same queries work
```

Available bridges: `fromDocAIPlugin`, `fromTextractPlugin`, `fromAzurePlugin`, `fromAdapterResult`.

## Plugin Composition

Plugins compose via dependency resolution + shared artifacts.

```
Source plugins (swappable — pick one):
  pymupdf        → local PyMuPDF extraction
  llamaParse     → LlamaIndex Cloud API
  okraOcr        → OkraPDF API
  doclingServe   → self-hosted IBM Docling
  pageIndex      → PageIndex AI RAG
  googleOcr      → Google Document AI (skeleton)
  fromDocAIPlugin / fromTextractPlugin / fromAzurePlugin → pre-cached adapter output

All source plugins set: ocr:pages, pdf:input
pymupdf also sets: toc:entries, pages:images (if extractImages: true)

Downstream plugins (compose with any source):
  vlmOpenRouter  → sets vlm:call handler for $().vlm(prompt)
  vlmEntityDetect → reads pages:images → table/figure/footnote tags
  vlmMarkdown    → reads pages:images + ocr:pages → markdown tags
```

Source plugins are swappable — they all produce the same `ocr:pages` artifact that downstream plugins consume.

## Artifact Contract

```ts
import { ARTIFACT_KEYS } from '@okrapdf/pdfquery-plugins';

ARTIFACT_KEYS.PDF_INPUT    // 'pdf:input'     — PDFInput
ARTIFACT_KEYS.PAGE_IMAGES  // 'pages:images'  — PageImage[]
ARTIFACT_KEYS.OCR_PAGES    // 'ocr:pages'     — OcrPage[]

// Set by vlmOpenRouter — consumed by QueryResult.vlm()
'vlm:call'                 // VLMCallHandler — (images, prompt) => Promise<string>
```

Plugins document what they set/read. This is the composition interface.

## Writing a Plugin

```ts
import type { PDFQueryPlugin, Tag } from 'pdfquery';

function myPlugin(config: { apiKey: string }): PDFQueryPlugin {
  return {
    name: 'my-plugin',
    depends: ['pymupdf'],  // optional — run after source plugin
    async run(ctx) {
      // Read artifacts from upstream plugins
      const pages = ctx.artifacts.get('ocr:pages');

      // Do your thing...
      const tags: Tag[] = [/* ... */];

      // Set artifacts for downstream plugins
      ctx.artifacts.set('my:data', someData);
      ctx.emit('my-plugin:complete', { count: tags.length });

      return { tags };
    },
  };
}
```

## Demos

```bash
# Extract + query (no API key needed)
bun run scripts/pdfquery-pymupdf-demo.ts path/to/any.pdf

# VLM queries (needs OPENROUTER_API_KEY)
source ~/dev/apikeys/.env && bun run scripts/pdfquery-vlm-demo.ts path/to/any.pdf
```
