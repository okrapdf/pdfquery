# pdfquery API Reference

jQuery-like query engine for PDF Virtual DOM (VDOM).

## Context Object

| Property | Type | Description |
|----------|------|-------------|
| `$` | `(selector) => QueryResult` | Query by type, tagName, or className |
| `$$` | `(selector) => QueryResult` | Alias for `$` |
| `doc` | `VdomTreeNode` | Full document tree |
| `currentPage` | `number` | Current page number |
| `page` | `(n) => QueryResult` | Query specific page |

## Selectors

| Selector | Example | Description |
|----------|---------|-------------|
| `*` | `$('*')` | All elements |
| `type` | `$('table')` | By element type |
| `.class` | `$('.ocr-block')` | By className |
| `#id` | `$('#table_123')` | By ID |
| `[attr=value]` | `$('[confidence>0.9]')` | Attribute filter |
| `:contains(text)` | `$(':contains(Revenue)')` | Text search |
| `:page(n)` | `$(':page(5)')` | On specific page |
| `:pages(1-10)` | `$(':pages(1-10)')` | Page range |
| `:first` | `$('table:first')` | First match |
| `:last` | `$('table:last')` | Last match |

## Methods

### Implemented ✅

| Method | Returns | Description |
|--------|---------|-------------|
| `.texts()` | `string[]` | Extract text content from results |
| `.ids()` | `string[]` | Get element IDs |
| `.countByType()` | `Record<string, number>` | Count elements by type |
| `.onPage(n)` | `QueryResult` | Filter to specific page |
| `.first()` | `VdomTreeNode \| null` | First result |
| `.last()` | `VdomTreeNode \| null` | Last result |
| `.length` | `number` | Count of results |
| `.nodes` | `VdomTreeNode[]` | Raw node array |

### Partially Implemented ⚠️

| Method | Returns | Status |
|--------|---------|--------|
| `.filter(selector)` | `QueryResult` | Basic - needs predicate fn support |
| `.near(selector, distance)` | `QueryResult` | Mock - needs spatial math |
| `.next(selector)` | `QueryResult` | Mock - needs sibling traversal |
| `.highlight()` | `QueryResult` | Mock - needs PDF overlay integration |
| `.stats()` | `StatsObject` | Mock - needs real calculation |

### Not Yet Implemented ❌

| Method | Returns | Description |
|--------|---------|-------------|
| `.map(fn)` | `any[]` | Transform results |
| `.each(fn)` | `QueryResult` | Iterate with side effects |
| `.attr(key)` | `any` | Get attribute value |
| `.attr(key, value)` | `QueryResult` | Set attribute (mutation) |
| `.sum()` | `number` | Sum numeric values |
| `.avg()` | `number` | Average numeric values |
| `.min()` / `.max()` | `number` | Min/max values |
| `.take(n)` | `QueryResult` | Limit results |
| `.skip(n)` | `QueryResult` | Offset results |
| `.not(selector)` | `QueryResult` | Exclude matches |
| `.contains(text)` | `QueryResult` | Text search filter |
| `.matches(regex)` | `QueryResult` | Regex filter |
| `.parent()` | `QueryResult` | Parent node |
| `.children()` | `QueryResult` | Direct children |
| `.siblings()` | `QueryResult` | Sibling nodes |
| `.above(selector)` | `QueryResult` | Spatial - elements above |
| `.below(selector)` | `QueryResult` | Spatial - elements below |
| `.leftOf(selector)` | `QueryResult` | Spatial - elements left |
| `.rightOf(selector)` | `QueryResult` | Spatial - elements right |
| `.within(bbox)` | `QueryResult` | Spatial - within bounding box |

## Usage Examples

```typescript
// Basic selection
$$('table')                    // All tables
$$('.currency')                // All currency values
$$('[confidence>0.9]')         // High confidence entities

// Chaining
$$('table').onPage(2).first()

// Stats (when implemented)
$$('.table').stats()
// { total: 5, verified: 3, flagged: 1, pending: 1, avgConfidence: 0.92 }

// Spatial queries (when implemented)
$$('table').near('.footnote', 50)
$$('figure').below('.heading')
```

## Architecture Notes

- Query engine runs in sandboxed `new Function()` context
- Context injected: `{ $, $$, doc, page, currentPage }`
- Results are chainable (jQuery-style fluent API)
- VDOM nodes have: `id`, `type`, `tagName`, `textContent`, `page`, `bbox`, `children`, `attributes`
