#!/usr/bin/env python3
"""
Qwen 2.5 VL Bounding Box Detection Script

Uses Qwen2.5-VL via OpenRouter to detect figures and footnotes in PDF pages
and return bounding box coordinates.

Usage:
    python scripts/qwen_bbox_detection.py <image_path> [--output <output_path>]

Example:
    python scripts/qwen_bbox_detection.py page_014.png
    python scripts/qwen_bbox_detection.py page_014.png --output page_014_annotated.png
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

# Load env from .env.local if present
def load_env():
    env_file = Path(__file__).parent.parent / ".env.local"
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    value = value.strip('"').strip("'")
                    os.environ.setdefault(key, value)

load_env()

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "qwen/qwen3-vl-235b-a22b-instruct"

# Colors for different element types
COLORS = {
    "figure": "#FF6B6B",      # Red
    "chart": "#4ECDC4",       # Teal
    "pie_chart": "#4ECDC4",
    "table": "#45B7D1",       # Blue
    "footnote": "#96CEB4",    # Green
    "footer": "#FFEAA7",      # Yellow
    "callout": "#DDA0DD",     # Plum
    "sidebar": "#FFB347",     # Orange
}


def encode_image_base64(image_path: str) -> str:
    """Encode image to base64 for API request."""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def get_image_dimensions(image_path: str) -> tuple[int, int]:
    """Get image width and height."""
    with Image.open(image_path) as img:
        return img.size


def detect_elements(image_path: str) -> dict:
    """
    Call Qwen 2.5 VL to detect figures and footnotes with bounding boxes.

    Returns dict with 'elements' list containing detected items with bbox_2d coordinates.
    """
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY environment variable not set")

    image_b64 = encode_image_base64(image_path)
    width, height = get_image_dimensions(image_path)

    # Qwen2.5-VL grounding prompt format
    # Official format: "Detect all X in the image and output their bbox coordinates in JSON format"
    # Note: Works best with resolution 480x480 to 2560x2560
    prompt = """Detect all figures, charts, footnotes, and callout boxes in this document page and output their bbox coordinates in JSON format.

Elements to detect:
- Figures (pie charts, bar charts, diagrams, images)
- Footnotes (small text at bottom with asterisks or reference numbers)
- Callout/info boxes (highlighted sections with statistics or key points)
- Tables with data

Return JSON array with format:
[{"bbox_2d": [x1, y1, x2, y2], "label": "figure|chart|footnote|callout|table", "description": "brief description"}]"""

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://okrapdf.com",
        "X-Title": "OkraPDF Bbox Detection",
    }

    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_b64}"
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }
        ],
        "max_tokens": 2000,
        "temperature": 0.1,  # Low temp for consistent bbox output
        "provider": {
            "zdr": True,
            "data_collection": "deny",
            "sort": "throughput"
        }
    }

    print(f"Calling {MODEL} via OpenRouter...")
    response = requests.post(OPENROUTER_URL, headers=headers, json=payload)
    response.raise_for_status()

    result = response.json()
    content = result["choices"][0]["message"]["content"]

    # Parse JSON from response
    # Handle case where model wraps in markdown code block
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0]
    elif "```" in content:
        content = content.split("```")[1].split("```")[0]

    content = content.strip()

    try:
        elements = json.loads(content)
    except json.JSONDecodeError as e:
        print(f"Warning: Could not parse JSON response: {e}")
        print(f"Raw response: {content}")
        elements = []

    return {
        "elements": elements,
        "image_width": width,
        "image_height": height,
        "model": MODEL,
        "usage": result.get("usage", {})
    }


def draw_bboxes(image_path: str, detection_result: dict, output_path: str = None) -> str:
    """
    Draw bounding boxes on the image and save annotated version.

    Returns path to annotated image.
    """
    if output_path is None:
        p = Path(image_path)
        output_path = str(p.parent / f"{p.stem}_annotated{p.suffix}")

    img = Image.open(image_path)
    draw = ImageDraw.Draw(img)
    img_width, img_height = img.size

    # Try to use a system font, fall back to default
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
    except:
        font = ImageFont.load_default()

    elements = detection_result.get("elements", [])

    for elem in elements:
        bbox = elem.get("bbox_2d", [])
        label = elem.get("label", "unknown")
        desc = elem.get("description", "")

        if len(bbox) != 4:
            continue

        x1, y1, x2, y2 = bbox

        # Qwen VL returns coordinates in 0-1000 normalized scale
        # Convert to actual pixel coordinates
        x1 = int(x1 * img_width / 1000)
        y1 = int(y1 * img_height / 1000)
        x2 = int(x2 * img_width / 1000)
        y2 = int(y2 * img_height / 1000)

        color = COLORS.get(label, "#888888")

        # Draw rectangle
        draw.rectangle([x1, y1, x2, y2], outline=color, width=3)

        # Draw label background
        label_text = f"{label}"
        text_bbox = draw.textbbox((x1, y1 - 20), label_text, font=font)
        draw.rectangle(text_bbox, fill=color)
        draw.text((x1, y1 - 20), label_text, fill="white", font=font)

    img.save(output_path)
    print(f"Saved annotated image to: {output_path}")

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Detect figures and footnotes with bounding boxes using Qwen 2.5 VL")
    parser.add_argument("image_path", help="Path to the image file")
    parser.add_argument("--output", "-o", help="Output path for annotated image")
    parser.add_argument("--json", "-j", action="store_true", help="Output detection results as JSON only")

    args = parser.parse_args()

    image_path = args.image_path
    if not os.path.exists(image_path):
        print(f"Error: Image not found: {image_path}")
        sys.exit(1)

    # Detect elements
    result = detect_elements(image_path)

    if args.json:
        print(json.dumps(result, indent=2))
        return

    # Print results
    print(f"\nDetected {len(result['elements'])} elements:")
    print("-" * 60)

    for i, elem in enumerate(result["elements"], 1):
        bbox = elem.get("bbox_2d", [])
        label = elem.get("label", "unknown")
        desc = elem.get("description", "")
        print(f"{i}. [{label}] {desc}")
        print(f"   bbox: {bbox}")

    if result.get("usage"):
        usage = result["usage"]
        print(f"\nTokens - Input: {usage.get('prompt_tokens', 'N/A')}, Output: {usage.get('completion_tokens', 'N/A')}")

    # Draw bounding boxes
    if result["elements"]:
        output_path = draw_bboxes(image_path, result, args.output)
        print(f"\nOpen annotated image: open {output_path}")
    else:
        print("\nNo elements detected to annotate.")


if __name__ == "__main__":
    main()
