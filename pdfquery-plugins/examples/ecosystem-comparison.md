# pdfquery vs Docling vs Unstructured — honest comparison

## What each tool actually is

**Docling** (IBM Research) — an **extraction engine**. Turns PDFs into structured `DoclingDocument` with layout detection, table structure, OCR. Five-stage threaded pipeline. Real ML models (Heron for layout, TableFormer for tables, SmolDocling VLM). Multi-format (PDF, DOCX, HTML, images, audio).

**Unstructured** — an **ETL pipeline for documents**. Partitions documents into typed `Element[]` (Title, Text, Table, Image). Four strategies (fast/hi_res/ocr_only/auto). Built-in chunking for RAG. Broad format support. Hosted API for production.

**pdfquery** — a **query layer for agents**. jQuery-like API over document elements. Plugin system composes extraction (pymupdf, Docling, Unstructured) with retrieval (PageIndex, LlamaIndex, vectors). User defines "ready" via plugin list.

They're different layers:
```
agent code
    ↓
pdfquery  ← query + compose     ($, artifacts, plugins)
    ↓
Docling / Unstructured / pymupdf  ← extract    (models, OCR, layout)
    ↓
PDF bytes
```

## What "ready" means to each

### Docling: pipeline options (fixed stages, toggle on/off)

```python
pipeline_options = PdfPipelineOptions(
    do_ocr=True,
    do_table_structure=True,
    do_code_enrichment=False,
    do_formula_enrichment=False,
    table_structure_options=TableStructureOptions(mode=TableFormerMode.ACCURATE),
)
converter = DocumentConverter(
    format_options={
        InputFormat.PDF: PdfFormatOption(
            pipeline_cls=StandardPdfPipeline,
            pipeline_options=pipeline_options,
        )
    }
)
result = converter.convert("report.pdf")
```

"Ready" = OCR done, tables structured, formulas skipped. Fixed 5-stage pipeline, you toggle stages. Can't add PageIndex tree search or vector embeddings here — that's a different system.

### Unstructured: strategy enum (4 choices)

```python
elements = partition_pdf(
    filename="report.pdf",
    strategy="hi_res",
    infer_table_structure=True,
    languages=["eng"],
    extract_image_block_types=["Image", "Table"],
)
```

"Ready" = elements partitioned. 4 strategies, pick one. After this you chunk and embed separately — Unstructured doesn't compose extraction with retrieval.

### pdfquery: plugin list (user-defined, composable)

```ts
// "Ready" = OCR text + tables + tree index for reasoning
const doc = await pdfquery.load([
  pymupdf({ pdf }),
  pageIndex({ model: 'gpt-4o-mini' }),
]);

// "Ready" = full extraction + vector embeddings for semantic search
const doc = await pdfquery.load([
  docling({ pdf, doTableStructure: true }),
  llamaIndex({ model: 'text-embedding-3-small' }),
]);

// "Ready" = just raw OCR, query blocks directly
const doc = await pdfquery.load([
  pymupdf({ pdf }),
]);

// "Ready" = Unstructured hi-res + PageIndex + custom plugin
const doc = await pdfquery.load([
  unstructured({ pdf, strategy: 'hi_res' }),
  pageIndex({ model: 'gpt-4o-mini' }),
  complianceCheck({ rules: 'sox-404' }),
]);
```

"Ready" is whatever you put in the array. Extraction, retrieval, custom logic — all compose through the same plugin interface. After `load()`, same `$()` API regardless.

## Where Docling genuinely beats pdfquery

### 1. Extraction quality — not close

Docling has real ML models. pdfquery has pymupdf.

| Capability | Docling | pdfquery (pymupdf) |
|---|---|---|
| Layout detection | Heron, RT-DETR, Egret | None |
| Table structure | TableFormer (cell-level) | PyMuPDF find_tables (basic) |
| OCR | RapidOCR, EasyOCR, Tesseract | PyMuPDF text extraction |
| VLM pipeline | SmolDocling, GraniteDocling | Skeleton only |
| Formula extraction | Yes | No |
| Code detection | Yes | No |

If you need accurate table cell extraction from complex layouts, Docling is better today. Period. PyMuPDF's `find_tables` works for clean PDFs but falls apart on multi-page tables, merged cells, or scanned documents.

### 2. Multi-format

Docling handles PDF, DOCX, PPTX, HTML, images, audio. pdfquery is PDF-only. Not even a contest.

### 3. DoclingDocument schema

Rich Pydantic model with hierarchy, provenance, formatting, character spans. pdfquery's Tag model is deliberately minimal (id, type, page, bbox, text, attrs). Docling preserves more information.

### 4. Battle-tested

IBM Research, used in enterprise. pdfquery is pre-release.

## Where Unstructured genuinely beats pdfquery

### 1. Production infrastructure

Hosted API, serverless processing, connectors to every vector store. pdfquery is a library — you'd build the infrastructure yourself.

### 2. Chunking

Built-in chunking strategies optimized for RAG. pdfquery has no chunking concept.

### 3. Element typing

20+ element types (Title, NarrativeText, ListItem, Address, EmailAddress, etc.) with semantic meaning. pdfquery has ~10 entity types, less granular.

### 4. Ecosystem integrations

LangChain, LlamaIndex, Pinecone, Weaviate connectors out of the box. pdfquery has no integrations yet.

## Where pdfquery has a real edge

### 1. Query API — neither Docling nor Unstructured has this

After extraction, Docling gives you a `DoclingDocument`. You iterate:

```python
# Docling: manual iteration
for table in result.document.tables:
    if table.prov[0].page_no == 5:
        for cell in table.data.grid:
            if "revenue" in cell.text.lower():
                print(cell.text)
```

Unstructured gives you `Element[]`. You filter:

```python
# Unstructured: list filtering
tables = [e for e in elements if e.category == "Table" and e.metadata.page_number == 5]
for t in tables:
    if "revenue" in t.text.lower():
        print(t.text)
```

pdfquery:

```ts
doc.$('table').onPage(5).contains('revenue').first()?.text
```

Chainable, composable, readable. This matters when an **agent is writing the code** — shorter expressions = fewer tokens = fewer errors.

### 2. Spatial queries — Docling has bboxes but no query API

Docling stores bounding boxes in provenance. But to find "which OCR blocks are inside this table's bbox" you'd write manual geometry code. pdfquery has `buildTagTree` (bbox containment nesting), `computeCoverage`, `findOrphans` built in.

```ts
// "Which text blocks are spatially inside tables on page 3?"
const tree = buildTagTree(doc.$('*').onPage(3).toTags());
// Tables automatically contain their child OCR blocks via bbox nesting
```

### 3. Extraction + retrieval in one session

This is the core differentiator. Docling extracts. Unstructured extracts. Then you pipe output to a separate retrieval system.

pdfquery composes both:

```ts
const doc = await pdfquery.load([
  docling({ pdf }),           // extraction (Docling's models)
  pageIndex({ model }),       // tree retrieval (PageIndex's algorithm)
  llamaIndex({ model }),      // vector retrieval
]);

// Agent has ALL of these through one API:
doc.$('table').onPage(5)                          // spatial query
doc.artifacts.get('tree:index')                   // tree navigation
doc.artifacts.get('vector:index')                 // semantic search
```

Docling and Unstructured would require gluing 3 separate systems together. pdfquery plugins share artifacts natively.

### 4. Agent-native design

Docling and Unstructured are designed for ETL: extract → chunk → embed → store → query. That's a pipeline you set up once and run.

pdfquery is designed for agents that write code per question:

```ts
async function answer(doc, question) {
  // Agent decides strategy per question
  const toc = doc.artifacts.get('toc:entries');

  // Structured? Direct navigation.
  if (isStructuredLookup(question)) {
    const page = toc.find(e => matchesSection(e, question))?.page;
    return doc.$('ocr').onPage(page).contains(keyword).first()?.text;
  }

  // Open-ended? Tree search.
  if (doc.artifacts.has('tree:index')) {
    return treeSearch(doc.artifacts.get('tree:index'), question);
  }

  // Fuzzy? Vector search.
  return vectorSearch(doc.artifacts.get('vector:index'), question);
}
```

The agent picks the strategy. With Docling/Unstructured, the pipeline is fixed at ingestion time.

## What pdfquery should NOT try to do

1. **Don't build ML models for extraction.** Docling's Heron/TableFormer are years of research. Wrap them as plugins instead.

2. **Don't build a hosted API.** Unstructured's serverless platform is a separate business. pdfquery is a library.

3. **Don't compete on format support.** DOCX/PPTX/HTML are Docling's strength. Stay focused on PDF query + composition.

## The real positioning

```
┌─────────────────────────────────────────────────────┐
│ Agent (Claude, GPT, etc.)                           │
│   writes code against pdfquery API                  │
├─────────────────────────────────────────────────────┤
│ pdfquery                                            │
│   $() queries, plugin composition, artifacts        │
├──────────┬──────────┬───────────┬───────────────────┤
│ Docling  │ Unstruct │ PyMuPDF   │ Custom extractor  │  ← extraction plugins
├──────────┴──────────┴───────────┴───────────────────┤
│ PageIndex│ LlamaIdx │ Vectors   │ Direct nav        │  ← retrieval plugins
└─────────────────────────────────────────────────────┘
```

pdfquery doesn't replace Docling or Unstructured. It's the layer that makes them composable with retrieval, queryable by agents, and lets the user define what "ready" means.

Docling's `DocumentConverter` and Unstructured's `partition()` are great at extraction. But after extraction, they hand you a data structure and walk away. pdfquery is what happens next — and it brings extraction and retrieval under one API so the agent doesn't have to glue systems together.

## The query chain IS the plugin interface

The `$()` selector isn't just for filtering. Plugins can extend it with methods — `.vlm()`, `.markdown()`, `.embed()` — that transform or query the matched elements. The chain is the universal interface to extraction, transformation, and retrieval.

```ts
// Direct text search (built-in, no plugin needed)
$('table').onPage(5).contains('revenue').first()?.text

// VLM query on matched elements (vlm plugin)
// Sends the table's page image + bbox crop to a vision model
await $('table').onPage(5).vlm("what's the total revenue?")

// Markdown extraction (vlm-markdown plugin)
// Converts matched elements to structured markdown via VLM
const md = await $('table').onPage(5).markdown()
await llm(md + "\nWhat's the revenue?")

// Embed matched elements (llamaindex plugin)
// Returns vector embeddings for the matched set
const embeddings = await $('ocr').onPage(5).embed()

// Chain them — narrow with queries, then transform
const answer = await $('table')
  .onPage(5)
  .contains('revenue')
  .vlm("extract the total revenue figure and YoY change")
```

Every step in the chain is a plugin opportunity. The selector narrows context, the method transforms or queries it. Compare:

**Docling**: extract everything upfront → iterate the result → manually crop/send to VLM
```python
# Docling: extract, then manual glue
result = converter.convert("report.pdf")
table = [t for t in result.document.tables if t.prov[0].page_no == 5][0]
image = render_page(5)
cropped = crop_to_bbox(image, table.prov[0].bbox)
answer = vlm_model(cropped, "what's the revenue?")  # manual wiring
```

**Unstructured**: partition → filter elements → manually send to LLM
```python
# Unstructured: partition, then manual glue
elements = partition_pdf("report.pdf", strategy="hi_res")
table = [e for e in elements if e.category == "Table" and e.metadata.page_number == 5][0]
answer = llm(table.metadata.text_as_html + "\nwhat's the revenue?")  # manual wiring
```

**pdfquery**: query chain handles everything
```ts
// pdfquery: one chain
await $('table').onPage(5).vlm("what's the revenue?")
```

The difference isn't just syntax sugar. When an **agent writes code**, shorter chains = fewer tokens = fewer bugs = faster iteration. And the agent doesn't need to know which plugin provides `.vlm()` or `.markdown()` — it's just a method on the selector. Swap the VLM provider plugin and the agent code doesn't change.

### How plugins extend the chain

```ts
// A plugin can register methods on the query result
function vlmPlugin(config: { model: string }): PDFQueryPlugin {
  return {
    name: 'vlm',
    async run(ctx) {
      // Register .vlm() on query results
      ctx.$.extend('vlm', async function(this: QueryResult, prompt: string) {
        const entities = this.toArray();
        const pages = [...new Set(entities.map(e => e.pageIndex))];
        const images = pages.map(p => ctx.artifacts.get('pages:images')[p]);

        // Crop to matched elements' bboxes, send to VLM
        const results = await Promise.all(
          entities.map(async (entity) => {
            const cropped = cropImage(images[entity.pageIndex], entity.bbox);
            return callVLM(config.model, cropped, prompt);
          })
        );

        return results;
      });

      return { tags: [] };
    },
  };
}

// Now any query chain can use .vlm()
const doc = await pdfquery.load([
  pymupdf({ pdf, extractImages: true }),
  vlmPlugin({ model: 'qwen-vl-max' }),
]);

await doc.$('table').onPage(5).vlm("extract all dollar amounts")
```

The plugin registers a method. The agent uses the method on any selector result. The plugin handles image cropping, VLM calls, bbox alignment — the agent just chains.

## Any pipeline that outputs data is just a plugin

The plugin interface is: take input, return `Tag[]`. That's it. Anything that produces structured output — Docling, Unstructured, a CSV, a markdown file, a JSON dump from some vendor API — is a plugin.

```ts
// Docling → plugin
function docling(config): PDFQueryPlugin {
  return {
    name: 'docling',
    async run(ctx) {
      const result = await runDocling(config);
      return {
        tags: [
          ...result.tables.map(t => ({
            id: t.self_ref, type: 'table', page: t.prov[0].page_no,
            bbox: provToBbox(t.prov[0]), text: t.export_to_markdown(),
          })),
          ...result.texts.map(t => ({
            id: t.self_ref, type: t.obj_type === 'title' ? 'heading' : 'ocr',
            page: t.prov[0].page_no, bbox: provToBbox(t.prov[0]), text: t.text,
          })),
        ],
      };
    },
  };
}

// Unstructured → plugin
function unstructured(config): PDFQueryPlugin {
  return {
    name: 'unstructured',
    async run(ctx) {
      const elements = await partitionPdf(config);
      return {
        tags: elements.map(el => ({
          id: el.element_id, type: elTypeToTag(el.category),
          page: el.metadata.page_number, bbox: coordsToBbox(el.metadata.coordinates),
          text: el.text,
        })),
      };
    },
  };
}

// CSV file → plugin
function csv(config: { path: string; page?: number }): PDFQueryPlugin {
  return {
    name: 'csv',
    run() {
      const rows = parseCSV(readFileSync(config.path, 'utf-8'));
      return {
        tags: rows.map((row, i) => ({
          id: `csv-row-${i}`, type: 'table_row', page: config.page ?? 1,
          bbox: { x: 0, y: i / rows.length, width: 1, height: 1 / rows.length },
          text: Object.values(row).join(' | '),
          attrs: row,
        })),
      };
    },
  };
}

// Markdown file → plugin
function markdown(config: { content: string; page?: number }): PDFQueryPlugin {
  return {
    name: 'markdown',
    run() {
      const sections = splitMarkdownSections(config.content);
      return {
        tags: sections.map((s, i) => ({
          id: `md-${i}`, type: s.isTable ? 'table' : s.isHeading ? 'heading' : 'ocr',
          page: config.page ?? 1,
          bbox: { x: 0, y: i / sections.length, width: 1, height: 1 / sections.length },
          text: s.text,
          attrs: { level: s.level },
        })),
      };
    },
  };
}

// Pre-cached JSON from any vendor API → plugin
function fromJSON(data: { entities: any[] }): PDFQueryPlugin {
  return {
    name: 'json-import',
    run: () => ({ tags: data.entities.map(normalize) }),
  };
}

// LlamaParse output → plugin
function llamaParse(config): PDFQueryPlugin {
  return {
    name: 'llama-parse',
    async run(ctx) {
      const result = await callLlamaParse(config);
      ctx.artifacts.set('ocr:pages', result.pages);
      return { tags: llamaParseToTags(result) };
    },
  };
}
```

All of these produce `Tag[]`. After `load()`, same API:

```ts
// Doesn't matter if tags came from Docling, Unstructured, a CSV, or raw JSON
doc.$('table').onPage(5).contains('revenue')
doc.$('heading').texts()
doc.$('[confidence>0.9]').count()
```

pdfquery doesn't care where the data came from. It just queries it. That's why it's not competing with Docling or Unstructured — it's the layer they plug into.
