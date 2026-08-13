# Vendored Rust dependencies

## `pdf-inspector`

`pdf-inspector` is vendored because pdfquery carries contract-compatibility
patches that are not part of upstream.

Base provenance:

- upstream repository: <https://github.com/firecrawl/pdf-inspector>;
- upstream snapshot: commit
  `89dd20d02cf14c329e7d0d0f2b861691458264e2` from `main` (the manifest at
  that commit declares version `1.14.1`);
- license: MIT, Copyright (c) 2026 Firecrawl. The distributed notice is in
  `THIRD_PARTY_NOTICES` at the repository root. The embedded Adobe CMap
  resources retain their separate notice there as well.

Local delta from that upstream snapshot:

- never merge adjacent extracted text items across an MCID boundary;
- preserve marked-content ownership while walking Form XObjects;
- expose the full text-rendering transform behind the private
  `pdfquery-transform` feature and retain it through text/table transforms;
- calculate text widths from the full affine scale magnitude so angled and
  rotated text keeps compatible geometry;
- preserve fractional simple-font and CID widths as `f32` rather than
  truncating them to integers;
- expose positioned-text extraction from an already parsed `lopdf::Document`
  so pdfquery can share one parse between structure and text extraction;
- expose an opt-in path that retains rendering-mode-3 text, matching the
  previous PDF.js contract for tagged invisible/OCR content;
- propagate decompression-budget failures through content, Form XObject,
  font/CMap, detector, and page-extraction paths instead of silently treating
  compressed bytes as decoded content;
- add the narrow casts required by pdfquery's `f64` `lopdf::Object::Real`
  compatibility fork.

Upstream documentation, Python-only packaging files, and the multi-megabyte
PDF fixture corpus are omitted. CI runs the portable vendored regressions that
do not depend on those fixtures—most importantly
`merge_items_never_crosses_mcid_boundaries`—instead of downloading fixtures or
claiming that the repository-only fixture tests ran.

When refreshing the vendor tree, record and diff the exact upstream commit,
replay or retire each local delta explicitly, run the native and WASM checks,
and update this provenance record and `THIRD_PARTY_NOTICES` in the same change.

## `lopdf`

`lopdf` is vendored so pdfquery can preserve PDF real-number precision at the
parser boundary instead of irreversibly narrowing values before serialization.

Base provenance:

- crate: `lopdf` 0.42.0 from crates.io;
- upstream repository: <https://github.com/J-F-Liu/lopdf>;
- upstream VCS commit recorded by the crate:
  `b68476c2a067f3b5158de60cd8ebce69f72068c8`;
- crates.io archive SHA-256:
  `25aab26d99567469098e64a02f42679f8965c6401263eefa31d8f2dcc37a221c`;
- license: MIT, Copyright (c) 2016 Junfeng Liu. The distributed notice is in
  `THIRD_PARTY_NOTICES` at the repository root.

Local delta from that crate release:

- parse and store PDF `Real` objects as `f64` rather than `f32`;
- preserve the existing `f32` accessor API by narrowing only when callers
  explicitly request it;
- construct Form XObject `BBox` and `Matrix` values through the widened number
  conversion;
- limit each decoded stream to 32 MiB across Flate, raw-Deflate fallback, LZW,
  ASCII85, filter chains, and PNG predictors;
- limit cumulative decoded content for one page to 64 MiB and propagate the
  limit through object-stream loading and page-content concatenation;
- make the upstream preceding-bytes reader test self-contained because the
  registry source archive omits its referenced `assets/example.pdf` fixture.

pdfquery and the vendored `pdf-inspector` retain `f64` for serialized PDF
values, then cast to `f32` only where the extraction engine performs layout
math. Refresh this vendor tree with the same checksum, diff, test, and notice
discipline described above.
