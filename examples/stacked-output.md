# `examples/stacked.ts` output

NVIDIA 10-Q (48 pages). pymupdf + deferred llamaParse + VLM.

```
=== Loading (pymupdf runs, llamaParse deferred) ===

--- pymupdf results (instant) ---
  $('*').count():                1256 entities
  $('table').count():            42 tables
  $('ocr').count():              1166 OCR blocks
  $('heading').count():          0 headings
  $('*').countByPage():          [[1,31],[2,37],[3,33],[4,18],[5,41],[6,36],...]
  $('ocr').contains('revenue'):  71 hits
    first: "Revenue\n$\n57,006\n$\n35,082\n$\n147,811\n$\n91,166"

--- llamaParse deferred extraction (page 3) ---
  Requesting markdown (triggers upload + parse)...
  llamaparse: uploaded, job: 7e489ae9-32b9-4f5b-bb51-4f337f9bd95a
.............. done
  Got 3412 chars in 30725ms
  Preview: Part I. Financial Information # Item 1. Financial Statements (Unaudited)
  # NVIDIA Corporation and Subsidiaries # Condensed Consolidated Statements of Income
  # (In millions, except per share data)...

  Entities before: 1256, after: 1256

  Requesting same page again (should be cache hit)...
  2ms (vs 30725ms first time) — same content

--- VLM query ---
  Asking VLM about page 1...
  VLM says: This is the cover page of NVIDIA Corporation's Form 10-Q, a quarterly
  financial report filed with the U.S. Securities and Exchange Commission for the
  period ending October 26, 2025, detailing its status as a lar...

Done.
```

## What happened

| Step | Plugin | Trigger | Time |
|------|--------|---------|------|
| Load | pymupdf | `pdfquery.load()` | instant |
| Query | -- | `$('table').count()` | instant (1256 entities already in DOM) |
| Markdown | llamaParse | `$(':page(3)').markdown()` | 30s (upload + parse page 3 only) |
| Markdown | llamaParse | `$(':page(3)').markdown()` | **2ms** (cache hit) |
| VLM | vlmOpenRouter | `$('page:first').vlm(...)` | ~3s (Qwen3 VL 235B via OpenRouter) |
