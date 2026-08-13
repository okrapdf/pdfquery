# pdfquery performance benchmarks

This harness compares the current Rust/WebAssembly engine with the TypeScript
`pdfdom` engine that pdfquery used before the rewrite. It reports five distinct
costs instead of hiding them behind one average:

The latest checked-in measurement and profiling notes are in
[`RESULTS.md`](./RESULTS.md).

- `process-total`: a fresh Node process reads the PDF, loads the backend,
  parses, runs one query, prints only the result count, and exits;
- `open`: modules and PDF bytes are already warm, and only document creation is
  timed;
- `first-query`: a fresh parsed document runs its first query, including the
  Rust bridge's one-time JavaScript handle hydration;
- `open-and-first-query`: the combined in-process parse, first query, and
  handle-materialization cost with modules and bytes already loaded;
- `steady-query`: an already initialized document runs repeated queries.

The baseline is pinned by commit rather than inferred from the current sibling
checkout:

- pdfquery: `a8c511b46e80724900465f150f40a0478405b46c`;
- pdfdom: `64335178f13c43fa9f560d18dc729719d2f157bf`.

## Setup

Build the current release artifact first:

```sh
npm run build
```

Then prepare the exact baseline in a temporary directory. The script creates
detached Git worktrees and installs/builds there; it does not alter the current
branch or either main checkout:

```sh
node benchmarks/prepare-baseline.mjs
```

Run the checked-in smoke corpus:

```sh
npm run benchmark
```

For meaningful throughput results, pass one or more representative tagged PDFs
and selectors. Inputs are read before in-process measurements, so those results
are cache-warm. Process totals use fresh child processes but still share the
operating system's filesystem cache.

```sh
node --expose-gc benchmarks/run.mjs \
  --pdf /absolute/path/small.pdf \
  --pdf /absolute/path/large.pdf \
  --selector H1 \
  --selector '*'
```

The default JSON report is written below `benchmarks/results/`, which is
gitignored. Override it with `--output`. Use `--quick` for a short smoke run or
`--process-samples`, `--open-samples`, `--first-samples`, and
`--steady-samples` to change individual sample counts.

## Interpreting results

The report records Node, OS, CPU, memory, Git revisions, artifact hashes, input
hashes, bytes, result counts, every timing sample, median, p95, and interquartile
range. It also records the candidate's first and repeated protocol response
sizes. Engine order alternates for paired in-process samples. Correctness is
checked before timing by comparing ordered result IDs.

Do not turn wall-clock numbers into a pull-request pass/fail gate: hosted CI
machines are noisy. CI should keep enforcing correctness and compact protocol
shape; use this harness manually or from a controlled nightly machine for
performance trends.

For a JavaScript CPU profile of one worker workload:

```sh
node --cpu-prof --cpu-prof-dir benchmarks/results \
  benchmarks/worker.mjs current steady-query \
  /absolute/path/file.pdf H1 100
```

Release WebAssembly is stripped, so Node profiles show WASM time but usually do
not resolve individual Rust functions. Deeper Rust attribution requires a
separate symbol-preserving profiling build; published timings should continue
to use the release artifact.
