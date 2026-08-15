## v0.4.0 — unreleased

- Lock the `-o json` envelope as a tested automation contract: fixed
  `{selector, count, results, diagnostics}` keys, document-order results with
  identity de-duplication, exit 0 with `count: 0`/`results: []` for zero
  matches, and operational errors kept on stderr.
- Add `-o json-array` (one top-level array of serialized matches, `[]` when
  empty) and `-o jsonl` (one compact object per match, empty stdout when no
  matches) for direct `jq .[]` and streaming use.
- Add `--extract/-e` and `--extract-file/-E` declarative extraction maps:
  scalar first-match and array all-match semantics, `{selector, value}` field
  projections, nested maps evaluated relative to the selected node, one stable
  JSON object per run, and selector-path error reporting.
- Selector engine (via `@okrapdf/pdfdom` 0.3): attribute existence `[alt]`,
  `$=`, `~=`, `|=`, the `!=` jQuery extension, `i`/`s` case flags,
  `:not`/`:has`/`:is`/`:where` composition pseudos, `+`/`~` sibling
  combinators, and `:first`/`:last`/`:eq(n)` positional filters with
  PDF-order semantics.
- Add `fixtures/tagged-report-multi.pdf` plus `scripts/build-fixtures.mjs` for
  deterministic multi-page contract coverage.

## v0.3.0 — unreleased

- Add the sole public `pdfquery` executable for direct local tagged-PDF queries.
- Default `pdfquery report.pdf 'H1'` output is matched text, with JSON, size,
  and attribute output available explicitly.
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
