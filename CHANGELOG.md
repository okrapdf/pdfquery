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
