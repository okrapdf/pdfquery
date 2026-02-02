#!/usr/bin/env python3
"""
Unified PyMuPDF extraction for pdfquery plugins.

Extracts text blocks, tables, TOC, and optionally page images from a PDF.
Outputs a single JSON blob to stdout for the TypeScript plugin to consume.

Usage:
    python pymupdf_extract.py <pdf_path> [--images-dir /tmp/out] [--dpi 150]

All bounding boxes are normalized to 0-1 coordinates.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    print(json.dumps({"error": "PyMuPDF not installed. Run: pip install pymupdf"}))
    sys.exit(1)


def normalize_bbox(rect, page_width: float, page_height: float) -> list[float]:
    """Convert absolute rect [x0,y0,x1,y1] to normalized [x, y, width, height]."""
    if page_width == 0 or page_height == 0:
        return [0, 0, 0, 0]
    x = rect[0] / page_width
    y = rect[1] / page_height
    w = (rect[2] - rect[0]) / page_width
    h = (rect[3] - rect[1]) / page_height
    return [
        round(max(0, min(1, x)), 6),
        round(max(0, min(1, y)), 6),
        round(max(0, min(1, w)), 6),
        round(max(0, min(1, h)), 6),
    ]


def extract_blocks(doc) -> list[dict]:
    """Extract text blocks with normalized bboxes."""
    blocks = []
    block_id = 0
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        pw, ph = page.rect.width, page.rect.height
        page_num = page_idx + 1

        text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for blk in text_dict.get("blocks", []):
            if blk.get("type") != 0:  # text blocks only
                continue

            # Combine all spans in all lines of this block
            lines_text = []
            for line in blk.get("lines", []):
                span_texts = [span["text"] for span in line.get("spans", [])]
                line_str = "".join(span_texts).strip()
                if line_str:
                    lines_text.append(line_str)

            text = "\n".join(lines_text).strip()
            if not text:
                continue

            bbox = normalize_bbox(blk["bbox"], pw, ph)
            blocks.append({
                "id": f"b-{page_idx}-{block_id}",
                "page": page_num,
                "text": text,
                "bbox": bbox,
                "confidence": 1.0,
                "type": "paragraph",
            })
            block_id += 1

    return blocks


def extract_tables(doc) -> list[dict]:
    """Extract tables with markdown and normalized bboxes."""
    tables = []
    table_id = 0
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        pw, ph = page.rect.width, page.rect.height
        page_num = page_idx + 1

        found = page.find_tables()
        if not found or not found.tables:
            continue

        for t in found.tables:
            cells = len(t.cells)
            if cells < 4:
                continue

            # Build markdown from table data
            df = t.to_pandas()
            md_lines = []
            headers = [str(c) for c in df.columns]
            md_lines.append("| " + " | ".join(headers) + " |")
            md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
            for _, row in df.iterrows():
                vals = [str(v).replace("|", "\\|").strip() for v in row]
                md_lines.append("| " + " | ".join(vals) + " |")

            markdown = "\n".join(md_lines)
            bbox = normalize_bbox(t.bbox, pw, ph)

            tables.append({
                "id": f"t-{page_idx}-{table_id}",
                "page": page_num,
                "markdown": markdown,
                "bbox": bbox,
                "cells": cells,
                "rows": len(df),
                "cols": len(headers),
            })
            table_id += 1

    return tables


def extract_toc(doc) -> list[dict]:
    """Extract TOC using bookmarks, fall back to text-toc detection."""
    # Strategy 1: PDF bookmarks
    toc_raw = doc.get_toc(simple=True)
    if toc_raw:
        return [
            {"level": level, "title": title.strip(), "page": max(1, page)}
            for level, title, page in toc_raw
            if title.strip()
        ]

    # Strategy 2: find printed TOC page
    toc_keywords = ["TABLE OF CONTENTS", "CONTENTS", "目录", "目 录"]
    for i in range(min(15, doc.page_count)):
        text_upper = doc[i].get_text("text").upper()
        if any(kw.upper() in text_upper for kw in toc_keywords):
            return _parse_toc_page(doc[i].get_text("text"))

    return []


def _parse_toc_page(text: str) -> list[dict]:
    """Parse TOC entries from a printed TOC page."""
    import re

    entries = []
    patterns = [
        re.compile(r"^(.+?)\s*\.{3,}\s*(\d+)\s*$"),  # dots
        re.compile(r"^(.+?)\s{4,}(\d+)\s*$"),  # wide spaces
        re.compile(r"^(.+?)\t+(\d+)\s*$"),  # tabs
    ]

    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        for pattern in patterns:
            match = pattern.match(line)
            if match:
                entries.append({
                    "level": 1,
                    "title": match.group(1).strip(),
                    "page": int(match.group(2)),
                })
                break

    return entries


def extract_page_info(doc) -> list[dict]:
    """Get page dimensions."""
    pages = []
    for i in range(len(doc)):
        page = doc[i]
        pages.append({
            "page": i + 1,
            "width": round(page.rect.width),
            "height": round(page.rect.height),
        })
    return pages


def extract_images(doc, images_dir: str, dpi: int = 150) -> list[dict]:
    """Rasterize pages to PNG files. Returns metadata with file paths."""
    os.makedirs(images_dir, exist_ok=True)
    images = []
    mat = fitz.Matrix(dpi / 72, dpi / 72)

    for i in range(len(doc)):
        pix = doc[i].get_pixmap(matrix=mat)
        path = os.path.join(images_dir, f"page_{i + 1}.png")
        pix.save(path)
        images.append({
            "page": i + 1,
            "path": path,
            "width": pix.width,
            "height": pix.height,
            "mimeType": "image/png",
        })

    return images


def main():
    parser = argparse.ArgumentParser(description="PyMuPDF extraction for pdfquery")
    parser.add_argument("pdf_path", help="Path to PDF file")
    parser.add_argument("--images-dir", help="Dir to write page PNGs (omit to skip)")
    parser.add_argument("--dpi", type=int, default=150, help="DPI for page images")
    parser.add_argument("--no-tables", action="store_true", help="Skip table extraction")
    parser.add_argument("--no-toc", action="store_true", help="Skip TOC extraction")
    args = parser.parse_args()

    if not Path(args.pdf_path).exists():
        print(json.dumps({"error": f"File not found: {args.pdf_path}"}))
        sys.exit(1)

    start = time.time()
    doc = fitz.open(args.pdf_path)

    result = {
        "pages": extract_page_info(doc),
        "blocks": extract_blocks(doc),
        "tables": [] if args.no_tables else extract_tables(doc),
        "toc": [] if args.no_toc else extract_toc(doc),
        "images": [],
        "totalPages": len(doc),
        "elapsedMs": 0,
    }

    if args.images_dir:
        result["images"] = extract_images(doc, args.images_dir, args.dpi)

    doc.close()
    result["elapsedMs"] = round((time.time() - start) * 1000, 1)

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
