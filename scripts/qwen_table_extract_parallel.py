#!/usr/bin/env python3
"""
Extract tables from PDF pages using Qwen3 VL via OpenRouter.
PARALLEL version - 10 concurrent requests.
"""

import os
import sys
import json
import base64
import time
import asyncio
from pathlib import Path
from datetime import datetime

import fitz  # PyMuPDF
import httpx

# Config
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
MODEL = "qwen/qwen3-vl-235b-a22b-instruct"
INPUT_COST_PER_M = 0.20  # $/M tokens
OUTPUT_COST_PER_M = 1.20  # $/M tokens
CONCURRENCY = 10

SYSTEM_PROMPT = """You are a document table extraction assistant. Analyze this PDF page image.

If the page contains tables:
- Extract ALL tables as markdown tables
- Preserve headers, row/column structure
- Include any table titles or captions

If the page has NO tables:
- Return exactly: "NO_TABLES"

Return ONLY the markdown tables (or NO_TABLES), no explanations."""


def page_to_base64(page: fitz.Page, dpi: int = 150) -> str:
    """Convert PDF page to base64 PNG."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    return base64.b64encode(img_bytes).decode("utf-8")


async def extract_tables_from_page(
    client: httpx.AsyncClient,
    image_b64: str,
    page_num: int,
    semaphore: asyncio.Semaphore
) -> dict:
    """Call Qwen VL to extract tables from a page image."""
    async with semaphore:
        image_url = f"data:image/png;base64,{image_b64}"

        payload = {
            "model": MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Extract tables from page {page_num}. Return markdown tables or NO_TABLES."},
                        {"type": "image_url", "image_url": {"url": image_url}},
                    ],
                },
            ],
            "temperature": 0.1,
            "max_tokens": 4000,
            "provider": {"zdr": True, "data_collection": "deny", "sort": "throughput"},
        }

        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=120.0,
        )
        resp.raise_for_status()
        data = resp.json()

        content = data["choices"][0]["message"]["content"].strip()
        usage = data.get("usage", {})

        return {
            "page_num": page_num,
            "content": content,
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
        }


async def process_page(
    client: httpx.AsyncClient,
    doc: fitz.Document,
    page_idx: int,
    output_dir: Path,
    semaphore: asyncio.Semaphore,
    results: dict
):
    """Process a single page."""
    page_num = page_idx + 1
    page = doc[page_idx]

    # Convert to image
    image_b64 = page_to_base64(page)
    image_size_kb = len(image_b64) * 3 / 4 / 1024

    try:
        result = await extract_tables_from_page(client, image_b64, page_num, semaphore)
        content = result["content"]
        input_tokens = result["input_tokens"]
        output_tokens = result["output_tokens"]

        # Check if tables found
        has_tables = content.strip().upper() != "NO_TABLES"

        # Save markdown
        md_file = output_dir / f"page_{page_num:03d}.md"
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(f"# Page {page_num}\n\n")
            if has_tables:
                f.write(content)
            else:
                f.write("*No tables on this page*\n")

        status = "✓ tables" if has_tables else "- no tables"
        print(f"Page {page_num:3d}/281 {status} | in:{input_tokens} out:{output_tokens} | {image_size_kb:.0f}KB")

        results[page_num] = {
            "has_tables": has_tables,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }

    except Exception as e:
        print(f"Page {page_num:3d}/281 ERROR: {e}")
        md_file = output_dir / f"page_{page_num:03d}.md"
        with open(md_file, "w", encoding="utf-8") as f:
            f.write(f"# Page {page_num}\n\n")
            f.write(f"*Error: {e}*\n")
        results[page_num] = {"error": str(e), "input_tokens": 0, "output_tokens": 0}


async def main():
    if not OPENROUTER_API_KEY:
        print("Error: OPENROUTER_API_KEY not set")
        sys.exit(1)

    # Default to the 281-page PDF
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else "data/盛屯矿业集团股份有限公司2024年年度报告/盛屯矿业集团股份有限公司2024年年度报告.pdf"
    pdf_path = Path(pdf_path)

    if not pdf_path.exists():
        print(f"Error: PDF not found: {pdf_path}")
        sys.exit(1)

    # Create output directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = Path(f"scripts/output/qwen_tables_parallel_{timestamp}")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"PDF: {pdf_path}")
    print(f"Output: {output_dir}")
    print(f"Model: {MODEL}")
    print(f"Concurrency: {CONCURRENCY}")
    print("-" * 60)

    # Open PDF
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"Total pages: {total_pages}")
    print("-" * 60)

    # Tracking
    results = {}
    start_time = time.time()

    # Semaphore for concurrency control
    semaphore = asyncio.Semaphore(CONCURRENCY)

    async with httpx.AsyncClient() as client:
        tasks = [
            process_page(client, doc, page_idx, output_dir, semaphore, results)
            for page_idx in range(total_pages)
        ]
        await asyncio.gather(*tasks)

    doc.close()

    # Calculate totals
    total_input_tokens = sum(r.get("input_tokens", 0) for r in results.values())
    total_output_tokens = sum(r.get("output_tokens", 0) for r in results.values())
    pages_with_tables = sum(1 for r in results.values() if r.get("has_tables", False))

    elapsed = time.time() - start_time
    input_cost = (total_input_tokens / 1_000_000) * INPUT_COST_PER_M
    output_cost = (total_output_tokens / 1_000_000) * OUTPUT_COST_PER_M
    total_cost = input_cost + output_cost

    # Summary
    summary = f"""
{'=' * 60}
EXTRACTION COMPLETE (PARALLEL)
{'=' * 60}
PDF: {pdf_path.name}
Pages processed: {total_pages}
Pages with tables: {pages_with_tables}
Concurrency: {CONCURRENCY}
Time elapsed: {elapsed:.1f}s ({elapsed/total_pages:.2f}s/page effective)

TOKEN USAGE:
  Input tokens:  {total_input_tokens:,}
  Output tokens: {total_output_tokens:,}
  Total tokens:  {total_input_tokens + total_output_tokens:,}

COST BREAKDOWN:
  Input:  ${input_cost:.4f} ({total_input_tokens:,} @ ${INPUT_COST_PER_M}/M)
  Output: ${output_cost:.4f} ({total_output_tokens:,} @ ${OUTPUT_COST_PER_M}/M)
  TOTAL:  ${total_cost:.4f}

Output saved to: {output_dir}
{'=' * 60}
"""
    print(summary)

    # Save summary
    summary_file = output_dir / "SUMMARY.txt"
    with open(summary_file, "w") as f:
        f.write(summary)

    # Save cost tracking JSON
    cost_file = output_dir / "cost_tracking.json"
    with open(cost_file, "w") as f:
        json.dump({
            "pdf": str(pdf_path),
            "model": MODEL,
            "concurrency": CONCURRENCY,
            "total_pages": total_pages,
            "pages_with_tables": pages_with_tables,
            "elapsed_seconds": elapsed,
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "input_cost_usd": input_cost,
            "output_cost_usd": output_cost,
            "total_cost_usd": total_cost,
            "timestamp": timestamp,
        }, f, indent=2)


if __name__ == "__main__":
    asyncio.run(main())
