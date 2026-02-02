# pdfquery as the agent's query layer

pdfquery is the unified API that agents use to navigate documents. PageIndex, LlamaIndex, direct search — these are all plugins. The agent writes code against pdfquery's API and picks the right strategy per question.

```
agent writes code
    ↓
pdfquery API ($, artifacts, plugins)
    ↓
┌─────────────┬──────────────┬──────────────┬────────────┐
│ pymupdf     │ pageindex    │ llamaindex   │ direct     │
│ (extraction)│ (tree search)│ (vector RAG) │ (code nav) │
└─────────────┴──────────────┴──────────────┴────────────┘
```

## Setup: all strategies in one session

```ts
import pdfquery from 'pdfquery';
import { pymupdf } from '@okrapdf/pdfquery-plugins';

const doc = await pdfquery.load([
  pymupdf({ pdf: { type: 'path', path: './3m-10k-2018.pdf' } }),
  pageIndex({ model: 'gpt-4o-mini' }),    // tree index from PageIndex
  llamaIndex({ model: 'text-embedding-3-small' }), // vector index
]);

// Agent now has all strategies available through one session
```

## Agent picks the right strategy per question

### Q0: "What is FY2018 capital expenditure?" → direct navigation

Structured lookup. Agent knows it needs the cash flow statement → capex row. No LLM needed for navigation.

```ts
const toc = doc.artifacts.get('toc:entries') as TocEntry[];
const cfPage = toc.find(e => e.title.toLowerCase().includes('cash flow'))?.page;
const capex = doc.$('ocr').onPage(cfPage!).contains('purchases of property').first();
// → "Purchases of property, plant and equipment (PP&E)  (1,577)"
```

### Q2: "Is 3M capital-intensive?" → direct navigation (multi-page)

Agent pulls 3 numbers from 3 different financial statements, computes in code:

```ts
const revenue = doc.$('ocr').contains('net sales').onPage(
  toc.find(e => e.title.toLowerCase().includes('income'))!.page,
).first();

const capex = doc.$('ocr').contains('purchases of property').onPage(
  toc.find(e => e.title.toLowerCase().includes('cash flow'))!.page,
).first();

const totalAssets = doc.$('ocr').contains('total assets').onPage(
  toc.find(e => e.title.toLowerCase().includes('balance sheet'))!.page,
).first();

const capexRatio = parseNum(capex?.text) / parseNum(revenue?.text); // 5.1%
```

### Q3: "What drove operating margin change?" → PageIndex tree search

Open-ended reasoning question. Agent delegates to PageIndex's tree search because the answer is buried in prose across MD&A:

```ts
const tree = doc.artifacts.get('tree:index') as TreeNode[];
const { nodes, content } = await treeSearch(tree, 'operating margin change FY2022');
// PageIndex's LLM navigates: "Annual Report" → "MD&A" → "Results of Operations"
// Returns focused content from the right section

const answer = await llm(`What drove margin change?\n\n${content}`);
```

### Q4: "Which segment dragged growth?" → hybrid

Agent uses direct nav to find the segment section, then LLM on the specific table:

```ts
const segPage = toc.find(e => e.title.toLowerCase().includes('segment'))?.page;
const segTables = doc.$('table')
  .toArray()
  .filter(t => t.pageIndex + 1 >= segPage! && t.pageIndex + 1 <= segPage! + 3);

const growthTable = segTables.find(t =>
  t.text.toLowerCase().includes('organic'),
);

// LLM only sees the one relevant table
const answer = await llm(`Which segment had negative organic growth?\n\n${growthTable?.text}`);
```

### Q?: Semantic similarity question → LlamaIndex vector search

When the question doesn't map to a known section structure:

```ts
const vectorResults = doc.artifacts.get('vector:index') as VectorIndex;
const chunks = await vectorResults.search('dividend policy changes', { topK: 5 });
// Returns the 5 most semantically similar chunks
const answer = await llm(`${question}\n\nContext:\n${chunks.map(c => c.text).join('\n')}`);
```

## The point

PageIndex alone: every question goes through the same tree search loop. You can't control it.

LlamaIndex alone: every question goes through vector similarity. Works for fuzzy questions, wasteful for "what's on the balance sheet."

pdfquery: the agent has `$()`, TOC artifacts, tree search, and vector search all in one session. It writes code that picks the right tool:

```ts
async function answerQuestion(doc: PDFQuerySession, question: string) {
  const toc = doc.artifacts.get('toc:entries') as TocEntry[];

  // Strategy 1: Can we navigate directly via TOC + structured query?
  const directResult = tryDirectNavigation(doc, toc, question);
  if (directResult) return directResult;

  // Strategy 2: Does the tree index have a relevant section?
  const tree = doc.artifacts.get('tree:index') as TreeNode[];
  if (tree) {
    const treeResult = await treeSearch(tree, question);
    if (treeResult.confidence > 0.8) return treeResult;
  }

  // Strategy 3: Fall back to vector search
  const vectorIndex = doc.artifacts.get('vector:index');
  if (vectorIndex) {
    return await vectorSearch(vectorIndex, question);
  }

  // Strategy 4: Brute force — all text
  return await bruteForceSearch(doc, question);
}
```

## PageIndex as a plugin

```ts
import type { PDFQueryPlugin, Tag } from 'pdfquery';

interface PageIndexConfig {
  model?: string;
  maxPagesPerNode?: number;
}

function pageIndex(config: PageIndexConfig = {}): PDFQueryPlugin {
  return {
    name: 'page-index',
    depends: ['pymupdf'],

    async run(ctx) {
      const ocrPages = ctx.artifacts.get('ocr:pages') as OcrPage[];
      const tocEntries = ctx.artifacts.get('toc:entries') as TocEntry[] | undefined;
      const totalPages = ocrPages.length;

      // --- Build tree (same algorithm as PageIndex) ---
      let tree: TreeNode[];

      if (tocEntries && tocEntries.length > 0) {
        tree = tocToTree(tocEntries, totalPages);
      } else {
        tree = await generateTreeFromLLM(ocrPages, config.model);
      }

      tree = await subdivideTree(tree, ocrPages, config.maxPagesPerNode ?? 10, config.model);
      tree = await summarizeTree(tree, ocrPages, config.model);

      // Store as artifact — available to agent code and other plugins
      ctx.artifacts.set('tree:index', tree);

      // Also return heading tags so $('heading') queries work
      const tags: Tag[] = flattenTree(tree).map(node => ({
        id: node.node_id,
        type: 'heading',
        page: node.start_page,
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        text: node.title,
        attrs: {
          summary: node.summary,
          start_page: node.start_page,
          end_page: node.end_page,
        },
      }));

      return { tags };
    },
  };
}
```

## LlamaIndex as a plugin

```ts
function llamaIndex(config: { model?: string }): PDFQueryPlugin {
  return {
    name: 'llama-index',
    depends: ['pymupdf'],

    async run(ctx) {
      const ocrPages = ctx.artifacts.get('ocr:pages') as OcrPage[];

      // Build vector index from OCR text chunks
      const chunks = ocrPages.flatMap(page =>
        page.blocks.map(b => ({
          text: b.text,
          page: page.page,
          bbox: b.bbox,
        })),
      );

      const embeddings = await embedBatch(
        chunks.map(c => c.text),
        config.model ?? 'text-embedding-3-small',
      );

      const index = buildVectorIndex(chunks, embeddings);
      ctx.artifacts.set('vector:index', index);

      // No new tags — vector index is accessed via artifacts
      return { tags: [] };
    },
  };
}
```

## Comparison: single-strategy vs pdfquery

| Question type | PageIndex only | LlamaIndex only | pdfquery (agent picks) |
|---|---|---|---|
| "FY2018 capex?" | tree search → LLM (2 calls) | vector search → LLM (2 calls) | `$('ocr').contains()` (0 calls) |
| "Is 3M capital-intensive?" | tree search → LLM picks 3 nodes (2 calls, fragile) | vector search misses multi-section (unreliable) | direct nav × 3 sections (0 calls) |
| "What drove margin change?" | tree search → MD&A (2 calls, correct tool) | vector search → scattered chunks (noisy) | tree search → MD&A (2 calls, same as PageIndex) |
| "dividend policy sentiment" | tree search may miss (no clear section) | vector search finds semantically (1-2 calls, correct tool) | vector search (1-2 calls, same as LlamaIndex) |

No single strategy wins every question. pdfquery gives the agent all strategies through one API.

## Helpers

```ts
// TOC entries → nested tree (PageIndex's toc_transformer equivalent)
function tocToTree(entries: TocEntry[], totalPages: number): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  let nodeId = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nextPage = entries[i + 1]?.page ?? totalPages + 1;

    const node: TreeNode = {
      title: entry.title,
      node_id: String(++nodeId).padStart(4, '0'),
      start_page: entry.page,
      end_page: nextPage - 1,
      summary: '',
      children: [],
    };

    while (stack.length > 0 && stack.length >= entry.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

// Navigate tree with LLM (same as PageIndex's search_prompt)
async function treeSearch(
  tree: TreeNode[],
  question: string,
): Promise<{ nodes: TreeNode[]; content: string; confidence: number }> {
  const treeJson = JSON.stringify(
    tree.map(function strip(n): any {
      return { node_id: n.node_id, title: n.title, summary: n.summary, nodes: n.children.map(strip) };
    }),
    null, 2,
  );

  const result = await llm(`
You are given a question and a tree structure of a document.
Find all nodes likely to contain the answer.

Question: ${question}
Document tree: ${treeJson}

Reply JSON: { "thinking": "...", "node_list": ["node_id_1", ...], "confidence": 0.0-1.0 }
  `);

  const parsed = JSON.parse(result);
  const nodeMap = new Map<string, TreeNode>();
  const walk = (n: TreeNode) => { nodeMap.set(n.node_id, n); n.children.forEach(walk); };
  tree.forEach(walk);

  const nodes = parsed.node_list.map((id: string) => nodeMap.get(id)).filter(Boolean);
  const content = nodes.map((n: TreeNode) => n.summary).join('\n\n');

  return { nodes, content, confidence: parsed.confidence ?? 0.5 };
}

function parseNum(text?: string): number {
  if (!text) return 0;
  const negative = text.includes('(') && text.includes(')');
  const cleaned = text.replace(/[$,()%\s]/g, '');
  const match = cleaned.match(/-?[\d.]+/);
  if (!match) return 0;
  return negative ? -parseFloat(match[0]) : parseFloat(match[0]);
}

interface TreeNode {
  title: string;
  node_id: string;
  start_page: number;
  end_page: number;
  summary: string;
  children: TreeNode[];
}

interface TocEntry { level: number; title: string; page: number }
interface OcrPage { page: number; blocks: Array<{ text: string; bbox: any }> }
```
