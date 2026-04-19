# pdfquery

```ts
import pdfquery from 'pdfquery'

const doc = { id: 'doc-2026-04' }
const page = { id: 'page-1', number: 1 }
const annotation = { id: 'annot-7', page: 1 }

const $doc = pdfquery([doc, page, annotation])

$doc.on('change', (event) => {
  console.log('changed node', event.target, event.detail)
})

$doc.on('annotation', (event) => {
  console.log('annotation event', event.target, event.detail)
})

$doc.on('verify', (event) => {
  console.log('verification score', event.detail)
})

$doc.on('load', (event) => {
  console.log('loaded', event.target)
})

pdfquery(page).trigger('change', { field: 'rotation', value: 90 })
pdfquery(annotation).trigger('annotation', { x: 148, y: 320, text: 'check total' })
pdfquery(doc).trigger('verify', { score: 0.98, reasons: ['totals match'] })
pdfquery(doc).trigger('load')
```

pdfquery is a minimal, tree-agnostic, jQuery-style wrapper for object-shaped PDF nodes. It does not parse PDFs, construct trees, or implement CSS selectors. You bring your own nodes; pdfquery gives you a small collection wrapper and a WeakMap-backed event plane over those nodes.

The mental model: facets push events via `.trigger()`, consumers subscribe via `.on()`, and pdfquery is the tree-indexed broker in between.

## Install

```sh
npm install pdfquery
```

ESM only. Zero runtime dependencies. Runs in browsers, Node >=18, Cloudflare Workers, Bun, and Deno-compatible ESM environments.

## Typed Events

```ts
import pdfquery from 'pdfquery'

type PdfEvents = {
  verify: { score: number; reasons: string[] }
  annotation: { x: number; y: number; text: string }
  load: void
}

const nodes = [{ id: 'page-1' }]
const $ = pdfquery<{ id: string }, PdfEvents>(nodes)

$.on('verify', (event) => {
  event.detail.score
  event.target.id
})

$.trigger('verify', { score: 0.91, reasons: ['signature present'] })
$.trigger('load', undefined)
```

Unknown event names are still allowed and use `unknown` detail, which keeps pdfquery open to event names created by plugins, parser facets, and application code.

## Surface

| API | Description |
| --- | --- |
| `pdfquery(node)` | Wrap one object-shaped node. |
| `pdfquery(nodes)` | Wrap an array or iterable of object-shaped nodes. |
| `pdfquery(wrapper)` | Return an existing pdfquery collection. |
| `.on(type, handler)` | Subscribe handlers on each node in the collection. |
| `.off(type?, handler?)` | Remove one handler, all handlers for a type, or all handlers. |
| `.one(type, handler)` | Subscribe a handler that removes itself after one call. |
| `.trigger(type, detail?)` | Synchronously emit an event for each unique node in the collection. |
| `.each(fn)` | Iterate nodes and return the collection. |
| `.map(fn)` | Return a native array of mapped values. |
| `.filter(fn)` | Return a new collection of matching nodes. |
| `.first()` | Return a collection containing the first node, if present. |
| `.last()` | Return a collection containing the last node, if present. |
| `.eq(i)` | Return a collection containing the node at index `i`, if present. |
| `.length` | Number of nodes in the collection. |
| `[index]` | Indexed access to nodes. |
| `[Symbol.iterator]` | Use `for...of`, spread, or `Array.from`. |

## Errors

If an event handler throws, pdfquery continues invoking the remaining handlers. It then emits an `error` event on the same node with:

```ts
{ source: 'handler', type, error }
```

If no `error` listener is registered anywhere in the triggering collection, the original error is rethrown synchronously.

## What pdfquery Does Not Do

pdfquery v0.2 has no selector engine, traversal, mutation, content access, style helpers, ajax, DOM event bridge, or ready callback. See [divergence.md](./divergence.md) for the full jQuery divergence list.

## Companion Parser

Tree construction and provider adapters are moving to `@okrapdf/doc-parser` (WIP). Use that package, or your own parser/index, to produce the object-shaped nodes that pdfquery wraps.

## v1 Roadmap

- Keep the wrapper/event core small and dependency-free.
- Stabilize interop with `@okrapdf/doc-parser`.
- Document common PDF event vocabularies for parser facets, verification facets, annotation facets, and UI layers.
- Consider optional companion packages for selectors or traversal without adding them to core.

## License

MIT
