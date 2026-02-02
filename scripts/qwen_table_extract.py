#!/usr/bin/env python3
"""
Extract tables from PDF pages using Qwen3 VL via OpenRouter.
Tracks token usage and costs.
"""

import os
import sys
import json
import base64
import time
from pathlib import Path
from datetime import datetime

import fitz  # PyMuPDF
import httpx

# Config
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
MODEL = "qwen/qwen3-vl-235b-a22b-instruct"
INPUT_COST_PER_M = 0.20  # $/M tokens
OUTPUT_COST_PER_M = 1.20  # $/M tokens

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


def extract_tables_from_page(client: httpx.Client, image_b64: str, page_num: int) -> dict:
    """Call Qwen VL to extract tables from a page image."""
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

    resp = client.post(
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
        "content": content,
        "input_tokens": usage.get("prompt_tokens", 0),
        "output_tokens": usage.get("completion_tokens", 0),
    }


def main():
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
    output_dir = Path(f"scripts/output/qwen_tables_{timestamp}")
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"PDF: {pdf_path}")
    print(f"Output: {output_dir}")
    print(f"Model: {MODEL}")
    print("-" * 60)

    # Open PDF
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"Total pages: {total_pages}")

    # Tracking
    total_input_tokens = 0
    total_output_tokens = 0
    pages_with_tables = 0
    start_time = time.time()

    client = httpx.Client()

    try:
        for page_num in range(total_pages):
            page = doc[page_num]
            page_display = page_num + 1

            print(f"\nPage {page_display}/{total_pages}...", end=" ", flush=True)

            # Convert to image
            image_b64 = page_to_base64(page)
            image_size_kb = len(image_b64) * 3 / 4 / 1024

            # Extract tables
            try:
                result = extract_tables_from_page(client, image_b64, page_display)
                content = result["content"]
                input_tokens = result["input_tokens"]
                output_tokens = result["output_tokens"]

                total_input_tokens += input_tokens
                total_output_tokens += output_tokens

                # Check if tables found
                has_tables = content.strip().upper() != "NO_TABLES"
                if has_tables:
                    pages_with_tables += 1

                # Save markdown
                md_file = output_dir / f"page_{page_display:03d}.md"
                with open(md_file, "w", encoding="utf-8") as f:
                    f.write(f"# Page {page_display}\n\n")
                    if has_tables:
                        f.write(content)
                    else:
                        f.write("*No tables on this page*\n")

                status = "✓ tables" if has_tables else "- no tables"
                print(f"{status} | in:{input_tokens} out:{output_tokens} | {image_size_kb:.0f}KB")

            except Exception as e:
                print(f"ERROR: {e}")
                # Save error
                md_file = output_dir / f"page_{page_display:03d}.md"
                with open(md_file, "w", encoding="utf-8") as f:
                    f.write(f"# Page {page_display}\n\n")
                    f.write(f"*Error: {e}*\n")

            # Small delay to avoid rate limits
            time.sleep(0.5)

    finally:
        client.close()
        doc.close()

    # Calculate costs
    elapsed = time.time() - start_time
    input_cost = (total_input_tokens / 1_000_000) * INPUT_COST_PER_M
    output_cost = (total_output_tokens / 1_000_000) * OUTPUT_COST_PER_M
    total_cost = input_cost + output_cost

    # Summary
    summary = f"""
{'=' * 60}
EXTRACTION COMPLETE
{'=' * 60}
PDF: {pdf_path.name}
Pages processed: {total_pages}
Pages with tables: {pages_with_tables}
Time elapsed: {elapsed:.1f}s ({elapsed/total_pages:.2f}s/page)

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
    main()
