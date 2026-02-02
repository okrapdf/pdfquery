# pdfquery API Reference

jQuery-like query engine for PDF documents.

## Quick Start

```typescript
import { loadFixture, createQueryEngine } from 'pdfquery';

const doc = loadFixture('financial-report');
const $$ = createQueryEngine(doc);

$$('table').count();           // 4 tables
$$('.currency').sum();         // aggregate values
$$('[confidence>0.9]').texts(); // high-confidence extractions
```

## Selectors

| Selector | Example | Description |
|----------|---------|-------------|
| `*` | `$('*')` | All elements |
| `tag` | `$('table')` | By type (bare tag name) |
| `.type` | `$('.table')` | By type (dot prefix, same as above) |
| `#id` | `$('#table_123')` | By ID |
| `[attr=value]` | `$('[confidence>0.9]')` | Attribute filter |
| `[attr^=value]` | `$('[text^=Total]')` | Starts with |
| `[attr$=value]` | `$('[text$=USD]')` | Ends with |
| `[attr*=value]` | `$('[text*=revenue]')` | Contains |
| `:contains(text)` | `$(':contains(Revenue)')` | Text search |
| `:page(n)` | `$(':page(5)')` | On specific page |
| `:page(<=5)` | `$(':page(<=5)')` | Page comparison |
| `:pages(1-10)` | `$(':pages(1-10)')` | Page range |
| `:first` | `$('table:first')` | First match |
| `:last` | `$('table:last')` | Last match |
| `:eq(n)` | `$('table:eq(2)')` | Nth match (0-indexed) |
| `:gt(n)` | `$('table:gt(0)')` | Index greater than |
| `:lt(n)` | `$('table:lt(3)')` | Index less than |
| `:even` | `$('table:even')` | Even indices |
| `:odd` | `$('table:odd')` | Odd indices |

Selectors can be combined: `$('table[confidence>0.9]:first')`

## QueryResult Methods

### Filtering

| Method | Returns | Description |
|--------|---------|-------------|
| `.filter(selector)` | `QueryResult` | Filter by selector or predicate |
| `.not(selector)` | `QueryResult` | Exclude matches |
| `.contains(text)` | `QueryResult` | Text search (case-insensitive) |
| `.matches(regex)` | `QueryResult` | Regex filter |
| `.onPage(n)` | `QueryResult` | Filter to page (1-indexed) |
| `.inTable(id)` | `QueryResult` | Filter to table |
| `.take(n)` | `QueryResult` | First N entities |
| `.skip(n)` | `QueryResult` | Skip first N |
| `.first()` | `VirtualEntity?` | First entity or undefined |
| `.last()` | `VirtualEntity?` | Last entity or undefined |
| `.eq(n)` | `QueryResult` | Entity at index |
| `.byId(id)` | `QueryResult` | Entity by ID |

### Spatial Queries

| Method | Returns | Description |
|--------|---------|-------------|
| `.near(distance?, options?)` | `QueryResult` | Entities within distance (default 0.1) |
| `.above(options?)` | `QueryResult` | Entities above selection |
| `.below(options?)` | `QueryResult` | Entities below selection |
| `.leftOf(options?)` | `QueryResult` | Entities to the left |
| `.rightOf(options?)` | `QueryResult` | Entities to the right |
| `.within(bbox, options?)` | `QueryResult` | Entities in bounding box |

**Spatial Options:**
- `maxDistance`: Maximum distance (0-1 normalized). Default: 0.2 (vertical), 0.15 (horizontal)
- `requireOverlap`: Require horizontal/vertical overlap. Default: false
- `samePageOnly`: Only same page. Default: true

**within() Options:**
- `mode`: `'intersects'` (default) or `'contains'` (fully inside)

```typescript
// Find labels near currency values
$$('.currency').leftOf({ maxDistance: 0.2, requireOverlap: true })

// Find footnotes below tables
$$('table').below({ maxDistance: 0.3 })

// Find all entities in top half of page
$$('*').onPage(1).within({ xmin: 0, ymin: 0, xmax: 1, ymax: 0.5 })
```

### Sorting

| Method | Returns | Description |
|--------|---------|-------------|
| `.sortBy(key)` | `QueryResult` | Sort by key or function |
| `.sortByConfidence()` | `QueryResult` | Sort by confidence (desc) |
| `.sortByPosition()` | `QueryResult` | Sort top-to-bottom, left-to-right |

### Data Access

| Method | Returns | Description |
|--------|---------|-------------|
| `.text()` | `string?` | Text of first entity |
| `.texts()` | `string[]` | All text values |
| `.values()` | `(string\|number)[]` | Parsed values |
| `.ids()` | `string[]` | Entity IDs |
| `.types()` | `EntityType[]` | Entity types |
| `.attr(key)` | `any` | Get attribute from first entity |
| `.attr(key, value)` | `QueryResult` | Set attribute on all |
| `.data(key)` | `any` | Get custom data |
| `.data(key, value)` | `QueryResult` | Set custom data |

### Aggregation

| Method | Returns | Description |
|--------|---------|-------------|
| `.count()` | `number` | Count entities |
| `.sum()` | `number` | Sum numeric values |
| `.avg()` | `number` | Average numeric values |
| `.min()` | `number?` | Minimum value |
| `.max()` | `number?` | Maximum value |
| `.stats()` | `QueryStats` | Verification statistics |
| `.countByType()` | `Map<EntityType, number>` | Count by type |
| `.countByPage()` | `Map<number, number>` | Count by page |

### Grouping

| Method | Returns | Description |
|--------|---------|-------------|
| `.groupBy(fn)` | `Map<K, QueryResult>` | Group by key function |
| `.groupByPage()` | `Map<number, QueryResult>` | Group by page |
| `.groupByType()` | `Map<EntityType, QueryResult>` | Group by type |

### Iteration

| Method | Returns | Description |
|--------|---------|-------------|
| `.each(fn)` | `QueryResult` | Execute for each entity |
| `.map(fn)` | `T[]` | Transform entities |
| `.reduce(fn, initial)` | `T` | Reduce to single value |
| `.some(predicate)` | `boolean` | Any match predicate |
| `.every(predicate)` | `boolean` | All match predicate |
| `.find(predicate)` | `VirtualEntity?` | First matching entity |

### Rendering

| Method | Returns | Description |
|--------|---------|-------------|
| `.html(options?)` | `string` | Render as HTML |
| `.htmlDocument(options?)` | `string` | Full HTML document |
| `.htmlByPage(options?)` | `string` | HTML grouped by page |
| `.json()` | `string` | JSON string |
| `.toArray()` | `VirtualEntity[]` | Raw entity array |

### Mutations

| Method | Returns | Description |
|--------|---------|-------------|
| `.attr(key, value)` | `QueryResult` | Set attribute |
| `.attr(obj)` | `QueryResult` | Set multiple attributes |
| `.removeAttr(key)` | `QueryResult` | Remove attribute |
| `.toggleAttr(key)` | `QueryResult` | Toggle boolean attribute |
| `.changes()` | `EntityChange[]` | Get pending changes |
| `.getMutationLog()` | `MutationLog` | Get mutation log for sync |
| `.clearChanges()` | `QueryResult` | Clear pending changes |
| `.hasChanges()` | `boolean` | Check for pending changes |

## Entity Types

```typescript
type EntityType =
  | 'ocr' | 'table' | 'figure' | 'footnote' | 'markdown'
  | 'table_row' | 'table_cell'
  | 'currency' | 'percentage' | 'date' | 'text' | 'number'
  | 'header' | 'label' | 'total' | 'subtotal' | 'unknown';
```

## BoundingBox Format

Coordinates are normalized 0-1:

```typescript
interface BoundingBox {
  xmin: number;  // left edge (0-1)
  ymin: number;  // top edge (0-1)
  xmax: number;  // right edge (0-1)
  ymax: number;  // bottom edge (0-1)
}
```

## Examples

```typescript
// Find all tables on page 1
$$('table').onPage(1)

// Get high-confidence currency values
$$('currency[confidence>0.95]').values()

// Find labels to the left of amounts
$$('.currency').leftOf({ requireOverlap: true }).filter('.label')

// Aggregate revenue figures
$$(':contains(Revenue)').filter('.currency').sum()

// Group tables by page
$$('table').groupByPage()

// Mark tables as verified
$$('table[confidence>0.9]').attr('verified', true)

// Get mutation log for database sync
const log = $$('table').attr('verified', true).getMutationLog()
```
