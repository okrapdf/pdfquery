# pdfquery

Query a tagged PDF's native structure directly from the command line. Processing is local: there is no OCR, inferred structure, cloud service, parser registry, or host runtime.

```sh
npx --yes pdfquery@latest report.pdf 'H1'
```

The default output is one matched node's text per line. For the deterministic fixture in this repository:

```sh
npx --yes pdfquery@latest ./fixtures/tagged-report.pdf 'H1'
# Quarterly revenue
```

Input PDFs must contain a native `StructTreeRoot`. Untagged PDFs fail clearly instead of falling back to OCR or structure inference.

## CLI

```text
pdfquery <file.pdf|-> <selector> [options]

-o, --output text|json|json-array|jsonl|size
-a, --attribute name
-h, --help
-v, --version
```

Selectors include semantic roles (`H1`, `P`, `Table`), descendant and child combinators (`Sect > P`), attributes (`Figure[alt*="revenue"]`), `:contains(...)`, comma groups, and virtual page scopes (`page[page=4] H2`).

### JSON output contract

Use `--output json` or `-o json` when another tool needs a stable envelope:

```sh
pdfquery report.pdf H1 -o json | jq ".results"
pdfquery report.pdf H1 -o json | jq -r ".results[].text"
```

The JSON shape is:

```json
{
  "selector": "H6",
  "count": 0,
  "results": [],
  "diagnostics": []
}
```

`results` is ordered in document-query order. Comma groups and overlapping
selectors de-duplicate by node identity, so `H1,H1` reports one heading once.
Zero matches are successful: the command exits `0` and prints `count: 0`,
`results: []`, and the parser diagnostics collected while opening the PDF.
Operational errors, such as a missing file or an untagged PDF, are written to
stderr and exit non-zero; stdout is reserved for valid JSON in JSON mode.

The contract is enforced against a freshly built Rust/WebAssembly engine on
every pull request and `main` push. Run the focused gate locally with:

```sh
npm run test:contract
```

#### Result-only JSON projections

Use `json-array` when a consumer needs one top-level match collection. The
array contains the same serialized result objects, in the same order, as the
envelope's `results` field:

```sh
pdfquery report.pdf 'H1,Table' -o json-array | jq '.[]'
pdfquery report.pdf H1 -o json-array | jq -r '.[].text'
```

Use `jsonl` to stream one compact JSON object per physical output line. JSON
escaping keeps embedded newlines inside a result's text from splitting the
record:

```sh
pdfquery report.pdf '*' -o jsonl | jq -c 'select(.role == "H1")'
```

Both result-only modes omit envelope metadata and parser diagnostics. Use
`json` when those fields are required. Zero matches exit `0`: `json-array`
prints exactly `[]` followed by a newline, while `jsonl` prints nothing.
Operational errors go only to stderr, exit non-zero, and leave stdout empty in
all three machine-readable modes.

Structure-node results contain the node identity and structural metadata:

```json
{
  "id": "struct-6-0",
  "role": "H1",
  "rawRole": "ReportHeading",
  "parent": "struct-7-0",
  "children": [],
  "text": "Quarterly revenue",
  "ownText": "Quarterly revenue",
  "page": 1,
  "pages": [1],
  "mcids": [0],
  "content": [{ "type": "content", "page": 1, "mcid": 0 }],
  "language": "en-US",
  "bbox": {
    "x": 0.11764705882352941,
    "y": 0.06915151515151516,
    "width": 0.313843137254902,
    "height": 0.030303030303030304,
    "page": 1,
    "source": "text",
    "coordinateSpace": "normalized-page"
  },
  "bboxes": [],
  "attributes": {},
  "rawAttributes": {}
}
```

Nullable fields use `null` when the structure has no value. For example, the
root node has `"parent": null`; leaf nodes use an empty `children` array. Virtual
page results use the same envelope but a smaller result object:

```json
{
  "id": "page-1",
  "role": "page",
  "page": 1,
  "pages": [1],
  "text": "Quarterly revenue",
  "width": 612,
  "height": 792
}
```

To test an unpublished artifact exactly as npx will install it:

```sh
npm pack
npx --yes --package ./pdfquery-0.3.2.tgz -- \
  pdfquery ./fixtures/tagged-report.pdf 'H1'
```

## Installer

The production installer defaults to `pdfquery@latest` under the user-local `$HOME/.local` prefix, never invokes `sudo`, and requires Node.js >= 20.16 plus npm:

```sh
curl -fsSL https://raw.githubusercontent.com/okrapdf/pdfquery/main/install.sh | sh
pdfquery report.pdf 'H1'
```

For a pre-publish tarball or a user-owned install prefix:

```sh
curl -fsSL https://raw.githubusercontent.com/okrapdf/pdfquery/main/install.sh \
  | PDFQUERY_PACKAGE=https://example.test/pdfquery-0.3.2.tgz \
    PDFQUERY_PREFIX="$HOME/.local" sh
```

`PDFQUERY_PACKAGE` accepts any npm package spec, local tarball path, or tarball URL. If the chosen prefix's `bin` directory is not on `PATH`, the installer prints the exact directory to add.

### Container acceptance harness

Stage only the packed tarball, `fixtures/tagged-report.pdf`, `install.sh`, and `scripts/acceptance.sh` into each clean container. Run the two modes separately:

```sh
sh ./acceptance.sh npx ./pdfquery-0.3.2.tgz ./report.pdf
sh ./acceptance.sh install ./pdfquery-0.3.2.tgz ./report.pdf ./install.sh
```

The first mode runs npx against the explicit artifact from a clean temporary working directory/cache. The second starts a temporary local Node HTTP server, fetches `install.sh` with curl, installs the tarball URL to an isolated prefix, and invokes that exact prefix's binary. Both assert the exact `Quarterly revenue` result and trap all temporary/server cleanup. Host these commands with Crabbox only through `--provider local-container`; the harness itself never falls back to a checkout or globally installed `pdfquery`.

## JavaScript wrapper

The collection and event API is available as the package's default export. It is built on [Effect](https://effect.website): the constructor is a smart constructor, and the eventful methods return `Effect` values with typed error channels instead of chaining synchronously.

```ts
import { Effect } from 'effect'
import pdfquery from 'pdfquery'

const doc = { id: 'doc-2026-04' }
const page = { id: 'page-1', number: 1 }
const annotation = { id: 'annot-7', page: 1 }

const program = Effect.gen(function*() {
  const $doc = yield* pdfquery([doc, page, annotation])

  yield* $doc.on('change', (event) => {
    console.log('changed node', event.target, event.detail)
  })

  yield* $doc.on('annotation', (event) => {
    console.log('annotation event', event.target, event.detail)
  })

  yield* $doc.on('verify', (event) => {
    console.log('verification score', event.detail)
  })

  yield* $doc.on('load', (event) => {
    console.log('loaded', event.target)
  })

  yield* Effect.gen(function*() {
    const $page = yield* pdfquery(page)
    yield* $page.trigger('change', { field: 'rotation', value: 90 })
    const $annotation = yield* pdfquery(annotation)
    yield* $annotation.trigger('annotation', { x: 148, y: 320, text: 'check total' })
    const $ = yield* pdfquery(doc)
    yield* $.trigger('verify', { score: 0.98, reasons: ['totals match'] })
    yield* $.trigger('load')
  })
})

Effect.runPromise(program)
```

pdfquery is a minimal, tree-agnostic, jQuery-style wrapper for object-shaped PDF nodes. It does not parse PDFs, construct trees, or implement CSS selectors. You bring your own nodes; pdfquery gives you a small collection wrapper and a WeakMap-backed event plane over those nodes.

The mental model: facets push events via `.trigger()`, consumers subscribe via `.on()`, and pdfquery is the tree-indexed broker in between.

### Library install

```sh
npm install pdfquery
```

ESM only. The wrapper itself remains environment-neutral; the CLI requires Node >=20.16. The npm package has one runtime dependency: `effect` (v4 RC).

### Typed Events

```ts
import { Effect } from 'effect'
import pdfquery from 'pdfquery'

type PdfEvents = {
  verify: { score: number; reasons: string[] }
  annotation: { x: number; y: number; text: string }
  load: void
}

const nodes = [{ id: 'page-1' }]

const program = Effect.gen(function*() {
  const $ = yield* pdfquery<{ id: string }, PdfEvents>(nodes)

  yield* $.on('verify', (event) => {
    event.detail.score
    event.target.id
  })

  yield* $.trigger('verify', { score: 0.91, reasons: ['signature present'] })
  yield* $.trigger('load', undefined)
})
```

Unknown event names are still allowed and use `unknown` detail, which keeps pdfquery open to event names created by plugins, parser facets, and application code.

### Surface

| API | Description |
| --- | --- |
| `pdfquery(node)` | `Effect` wrapping one object-shaped node; fails with `PdfQueryInputError` for primitives, strings, and functions. |
| `pdfquery(nodes)` | `Effect` wrapping an array or iterable of object-shaped nodes. |
| `pdfquery(wrapper)` | `Effect` returning an existing pdfquery collection. |
| `.on(type, handler)` | `Effect` subscribing handlers on each node, yielding the collection. |
| `.off(type?, handler?)` | `Effect` removing one handler, all handlers for a type, or all handlers, yielding the collection. |
| `.one(type, handler)` | `Effect` subscribing a handler that removes itself after one call, yielding the collection. |
| `.trigger(type, detail?)` | `Effect<void, TriggerError>` emitting an event for each unique node in the collection. |
| `.each(fn)` | `Effect` iterating nodes, yielding the collection. |
| `.map(fn)` | Return a native array of mapped values (synchronous). |
| `.filter(fn)` | Return a new collection of matching nodes (synchronous). |
| `.first()` | Return a collection containing the first node, if present (synchronous). |
| `.last()` | Return a collection containing the last node, if present (synchronous). |
| `.eq(i)` | Return a collection containing the node at index `i`, if present (synchronous). |
| `.length` | Number of nodes in the collection. |
| `[index]` | Indexed access to nodes. |
| `[Symbol.iterator]` | Use `for...of`, spread, or `Array.from`. |

### Errors

If an event handler throws, pdfquery continues invoking the remaining handlers. It then emits an `error` event on the same node with:

```ts
{ source: 'handler', type, error }
```

If no `error` listener is registered anywhere in the triggering collection, the `trigger` effect fails with a `TriggerError` whose `cause` is the original thrown value.

### What the wrapper does not do

The JavaScript wrapper has no selector engine, traversal, mutation, content access, style helpers, ajax, DOM event bridge, or ready callback. The executable delegates direct tagged-PDF parsing and structural selection to the bundled Rust engine. See [divergence.md](./divergence.md) for the wrapper's full jQuery divergence list.

## Rust engine boundary

The collection and event wrapper stays in TypeScript because its contract is JavaScript object identity, typed handlers, and WeakMap-backed event state. The CLI's PDF work is implemented in Rust under `native/`: PDF loading, `StructTreeRoot` traversal, role mapping, marked-content text and geometry, selectors, and ordered JSON serialization. The Rust crate uses Firecrawl's `pdf-inspector` extraction core and `lopdf`, then compiles to a single Node-compatible WebAssembly module included in the npm tarball.

Source builds require stable Rust with the `wasm32-unknown-unknown` target and `wasm-pack` 0.15.0. Published users need only Node and npm: `npx`, the installer, stdin input, and every output mode continue to use the same JavaScript CLI interface, while the packed executable is self-contained and performs no native-addon download or postinstall build.

The engine rejects unusually expansive inputs before retaining more than 32 MiB from one decoded stream or 64 MiB of decoded content for one page. Tagged PDFs that exceed either resource limit fail explicitly instead of returning partial query results.

Reproducible before/after performance measurements live in [`benchmarks/`](./benchmarks/README.md). The harness pins the pre-Rust pdfquery and pdfdom commits, verifies ordered result IDs before timing, and reports process, parse, first-query, combined parse/query, steady-query, and protocol-payload measurements separately.

## Wrapper roadmap

- Keep the wrapper/event core small, with `effect` as its only runtime dependency.
- Stabilize interop with `@okrapdf/doc-parser`.
- Document common PDF event vocabularies for parser facets, verification facets, annotation facets, and UI layers.
- Consider optional companion packages for selectors or traversal without adding them to core.

## License

MIT
