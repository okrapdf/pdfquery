## v0.3.2 — 2026-08-12

- Add a named CI gate that rebuilds the Rust/WebAssembly engine and enforces
  the JSON output contract on every pull request and `main` push.
- Exercise the contract across repeated mixed native queries and a real Rust
  malformed-content recovery diagnostic.
- Verify the installed npm tarball preserves ordering, de-duplication, empty
  results, virtual-page shape, stderr behavior, and exact build output.

## v0.3.1 — 2026-08-12

- Replace the sibling `pdfdom`/`pdf-lib`/PDF.js CLI backend with a bundled Rust
  tagged-PDF and selector engine, while preserving the JavaScript collection
  and event interface and the CLI output contract.
- Bound decoded PDF streams and cumulative page content, returning an explicit
  resource-limit error instead of retaining decompression-bomb output.
- Add a pinned before/after benchmark harness and compact repeated-query
  protocol so JavaScript handle definitions cross the WASM boundary only once.
- Add result-only JSON array and JSONL output modes.

## v0.3.0 — 2026-08-06

- Add the sole public `pdfquery` executable for direct local tagged-PDF queries.
- Default `pdfquery report.pdf 'H1'` output is matched text, with JSON envelope,
  size, and attribute output available explicitly.
- Add deterministic tagged-PDF, npx packaging, and safe POSIX installer coverage.
- Preserve the v0.2 collection and WeakMap-backed event API.

## v0.2.0 — 2026-04-19 (wrapper rewrite)

Breaking. Complete redesign. Pre-0.2 code preserved on `archive-v0.1` branch.

pdfquery is now a tree-agnostic event-bus wrapper. It does not parse PDFs,
construct trees, or implement CSS selectors. 13-ish method surface:
constructor (3 overloads) + on/off/one/trigger + each/map/filter/first/last/eq
+ length + [index] + [Symbol.iterator].

- Zero runtime deps. ESM only. <5 KB min+gzip.
- Typed event detail via `<T, E>` event-map generic (HTMLElementEventMap pattern).
- Works on browser, Node ≥18, Cloudflare Workers, Bun, Deno.

Tree construction + provider adapters move to `@okrapdf/doc-parser` (WIP).

### Removed (breaking)
- Entire query engine, session API, fixtures, adapters — see archive-v0.1
- `pdfquery('selector')` string form — no selector engine in v0
- All traversal, mutation, content, and style methods
- `pdfquery(fn)` ready-callback — use `pdfquery(doc).on('load', fn)`
