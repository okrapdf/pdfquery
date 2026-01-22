# pdfQuery

jQuery for PDFs. Query extracted document entities with CSS-like selectors.

[**Live Demo / Inspector**](https://okrapdf.com/demo/inspector)

```bash
npm install pdfquery
```

## Usage

```typescript
import { createQueryEngine, DocCompiler } from 'pdfquery';

// Compile document from extracted entities
const compiler = new DocCompiler({ documentId: 'doc_123' });
compiler.addTables(tablesFromApi);
compiler.addEntities(entitiesFromApi);
const doc = compiler.compile();

// Query like jQuery
const $$ = createQueryEngine(doc);

// Select by type
$$('.table')              // All tables
$$('.currency')           // All currency values
$$('.figure')             // All figures

// Filter by attributes
$$('[confidence>0.9]')    // High confidence entities
$$('[verified=true]')     // Verified entities
$$('.table[confidence>0.8]') // High confidence tables

// Chain operations
$$('.currency')
  .onPage(2)
  .filter('[confidence>0.9]')
  .sum();

// Get statistics
$$('.table').stats();
// { total: 5, verified: 3, flagged: 1, pending: 1, avgConfidence: 0.92 }

// Mutations (jQuery-style .attr())
$$('.table[confidence>0.9]').attr('verified', true);
$$('[confidence<0.7]').attr({ flagReason: 'low confidence' });
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

## Document Compilation

```typescript
import { DocCompiler, fromEntitiesApi } from 'pdfquery';

// From API response
const entities = fromEntitiesApi(apiResponse);
const compiler = new DocCompiler({ documentId: 'my-doc' });
compiler.addExtractedEntities(entities);
const doc = compiler.compile();

// From multiple sources
compiler
  .addTables(tables)
  .addEntities(entities)
  .addOcrBlocks(ocrBlocks)
  .addMarkdownBlocks(markdownBlocks);
```

## License

MIT
