# Rust rewrite benchmark — 2026-08-12

This snapshot compares the release Rust/WebAssembly build on
`codex/pdfquery-rust-core` with the exact TypeScript backend used by pdfquery at
the start of the rewrite:

- pdfquery baseline: `a8c511b46e80724900465f150f40a0478405b46c`;
- pdfdom baseline: `64335178f13c43fa9f560d18dc729719d2f157bf`.

Measurements ran on an Apple M3 with 16 GiB RAM, macOS arm64, and Node 26.5.0.
The harness alternated engine order, compared ordered result IDs before timing,
used ten fresh processes for process totals, twelve samples for open and first
query costs, and fifteen batched samples for steady queries. Reported values are
medians. Filesystem cache was warm; in-process PDF bytes were preloaded.

## Real tagged PDFs

| Corpus and workload | TypeScript | Rust/WASM | Result |
| --- | ---: | ---: | ---: |
| 448 KiB / 1,442 nodes, fresh process `H1` | 289.83 ms | 166.89 ms | **1.74× faster** |
| 448 KiB / 1,442 nodes, open + first `H1` | 100.06 ms | 79.95 ms | **1.25× faster** |
| 448 KiB / 1,442 nodes, steady `H1` | 0.818 ms | 0.318 ms | **2.57× faster** |
| 448 KiB / 1,442 nodes, steady `*` | 0.765 ms | 0.593 ms | **1.29× faster** |
| 1.18 MiB / 3,694 nodes, fresh process `H1` | 684.15 ms | 685.84 ms | parity, Rust 0.25% slower |
| 1.18 MiB / 3,694 nodes, fresh process `*` | 681.47 ms | 686.94 ms | parity, Rust 0.80% slower |
| 1.18 MiB / 3,694 nodes, open + first `H1` | 493.17 ms | 380.43 ms | **1.30× faster** |
| 1.18 MiB / 3,694 nodes, steady `H1` | 2.007 ms | 0.842 ms | **2.38× faster** |
| 1.18 MiB / 3,694 nodes, steady `*` | 2.267 ms | 1.991 ms | **1.14× faster** |

The isolated first query remains slower in Rust: it hydrates JavaScript handles
that TypeScript created during `open`. That cost was roughly 15 ms versus 1.6 ms
on the 1,442-node file and 38 ms versus 2.7 ms on the 3,694-node file. Faster
parsing more than offsets it in the combined open-and-first-query workload.
Fresh-process time on the larger file is still limited by Node and WASM startup.

## Profiling-guided protocol fix

The first Rust candidate cloned and serialized every handle on every query.
Profiling exposed a 15–32× repeated-query regression. The native protocol now
sends the handle table only for the first successful query and sends ordered
result IDs afterward.

On the real corpora, a selective repeated response fell from 1.91–5.15 MiB to
46–311 bytes. A broad `*` response fell from 1.93–5.21 MiB to 22–59 KiB. The
compact protocol improved the candidate's repeated-query time by 23–46× versus
its initial implementation.

On a synthetic 500-page tagged PDF with 10,000 paragraph nodes:

| Candidate stage | Initial Rust protocol | Compact protocol | Change |
| --- | ---: | ---: | ---: |
| First native serialization | 830 ms | 62 ms | **13.4× faster** |
| Repeated native serialization | 170 ms | 8.2 ms | **20.8× faster** |
| Repeated payload | 27.14 MiB | 156 KiB | **99.44% smaller** |
| Candidate CLI `P -o size` | 1.65 s | 1.01 s | **1.63× faster** |
| Candidate CLI peak RSS | 678 MiB | 444 MiB | **34.5% lower** |

The same synthetic input still favors the TypeScript baseline overall: about
0.89 s and 317 MiB peak RSS versus 0.94 s and 467 MiB for the compact Rust
worker. Parsing/extraction now dominates the Rust profile at roughly 779 ms,
so structure materialization and WASM memory are the next optimization targets.

Release WASM is stripped. Node CPU profiles therefore attribute time to WASM
but cannot reliably name individual Rust functions. A symbol-preserving build
is required for deeper native attribution; it must not be used for published
timing comparisons.
