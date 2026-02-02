/**
 * Draw LlamaParse bounding boxes on the page image.
 * Three layers, three colors:
 *   RED    = items[].bBox     (PDF point coords, /pageWidth /pageHeight)
 *   GREEN  = layout[].bbox    (already 0-1 normalized)
 *   BLUE   = images[0].ocr[]  (image pixel coords, /original_width /original_height)
 *
 * Usage: bun run scripts/llamaparse-overlay.ts
 */

import { readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'llamaparse-output/03-result-json.json'), 'utf-8'));
const page = fixture.pages[0];
const pageW = page.width;   // 612 PDF points
const pageH = page.height;  // 792 PDF points

// Render page via pymupdf
const pdfPath = process.argv[2] || join(process.env.HOME!, 'dev/okrapdf/tsla-20250422-gen.pdf');
const targetPage = 6;
const outDir = join(import.meta.dirname, 'llamaparse-output');
mkdirSync(outDir, { recursive: true });

const pngPath = join(outDir, 'page-render.png');
execSync(`python3 -c "
import pymupdf
doc = pymupdf.open('${pdfPath}')
page = doc[${targetPage - 1}]
pix = page.get_pixmap(dpi=200)
pix.save('${pngPath}')
doc.close()
"`);
console.log(`Rendered page ${targetPage} → ${pngPath}`);

const imgMeta = await sharp(pngPath).metadata();
const imgW = imgMeta.width!;
const imgH = imgMeta.height!;
console.log(`Image: ${imgW}x${imgH}`);

// Helper: draw a rect overlay
async function drawRect(
  buf: Buffer,
  x: number, y: number, w: number, h: number,
  color: string, label?: string,
): Promise<Buffer> {
  const px = Math.round(x * imgW);
  const py = Math.round(y * imgH);
  const pw = Math.round(w * imgW);
  const ph = Math.round(h * imgH);
  if (pw < 1 || ph < 1) return buf;

  const strokeWidth = 2;
  const fontSize = 10;
  const svg = `<svg width="${imgW}" height="${imgH}">
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}"
      fill="none" stroke="${color}" stroke-width="${strokeWidth}" />
    ${label ? `<text x="${px + 2}" y="${py - 3}" font-size="${fontSize}" fill="${color}" font-family="monospace">${label}</text>` : ''}
  </svg>`;

  return await sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();
}

let buf = readFileSync(pngPath) as Buffer;

const colorMap: Record<string, string> = {
  heading: '#ff0000',  // red
  text: '#0066ff',     // blue  
  table: '#00cc00',    // green
};

// Items only — the structured elements with text + bboxes
console.log(`\nDrawing ${page.items.length} items (color by type)...`);
for (const item of page.items) {
  if (!item.bBox) continue;
  const nx = item.bBox.x / pageW;
  const ny = item.bBox.y / pageH;
  const nw = item.bBox.w / pageW;
  const nh = item.bBox.h / pageH;
  const color = colorMap[item.type] || '#ff00ff';
  const label = `${item.type}${item.lvl ? item.lvl : ''}: ${(item.value || '').slice(0, 40)}`;
  console.log(`  ${color} ${label}`);
  console.log(`    bbox: (${nx.toFixed(3)},${ny.toFixed(3)}) ${nw.toFixed(3)}x${nh.toFixed(3)}  conf=${item.bBox.confidence}`);
  buf = await drawRect(buf, nx, ny, nw, nh, color, `${item.type}${item.lvl || ''}`);
}

const outPath = join(outDir, 'page6-llamaparse-overlay.png');
await sharp(buf).toFile(outPath);
console.log(`\nSaved: ${outPath}`);
console.log('  RED   = items[].bBox (structured elements)');
console.log('  GREEN = layout[].bbox (layout detection)');
console.log('  BLUE  = images[0].ocr[] (word-level OCR)');

execSync(`open "${outPath}"`);
