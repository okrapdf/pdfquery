/**
 * Capture raw LlamaParse JSON response for one page.
 * Saves full API response as fixture for reverse-engineering the schema.
 *
 * Usage:
 *   bun run scripts/llamaparse-raw-capture.ts <pdf-path> [page]
 */

import { config } from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

config({ path: `${process.env.HOME}/dev/apikeys/.env` });

const API_KEY = process.env.LLAMAINDEX_API_KEY;
const API_BASE = 'https://api.cloud.llamaindex.ai';

if (!API_KEY) { console.error('LLAMAINDEX_API_KEY not set'); process.exit(1); }

const pdfPath = process.argv[2];
if (!pdfPath) { console.error('Usage: bun run scripts/llamaparse-raw-capture.ts <pdf> [page]'); process.exit(1); }
const targetPage = process.argv[3] || '6'; // default page 6 (Tesla financial summary)

const outDir = join(import.meta.dirname, '..', 'scripts', 'llamaparse-output');
mkdirSync(outDir, { recursive: true });

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log(`PDF: ${pdfPath}, page: ${targetPage}`);

  // 1. Upload with all the rich options
  const pdfData = readFileSync(pdfPath);
  const formData = new FormData();
  formData.append('file', new Blob([pdfData], { type: 'application/pdf' }), 'doc.pdf');
  formData.append('extract_layout', 'true');
  formData.append('target_pages', targetPage);
  // Try to get images too
  formData.append('take_screenshot', 'true');
  formData.append('save_images', 'true');

  console.log('Uploading...');
  const uploadRes = await fetch(`${API_BASE}/api/parsing/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });

  const uploadBody = await uploadRes.json();
  console.log('Upload response:', JSON.stringify(uploadBody, null, 2));
  writeFileSync(join(outDir, '01-upload.json'), JSON.stringify(uploadBody, null, 2));

  if (!uploadRes.ok) { console.error('Upload failed'); process.exit(1); }
  const jobId = uploadBody.id;
  console.log(`Job: ${jobId}`);

  // 2. Poll
  console.log('Polling...');
  for (let i = 0; i < 60; i++) {
    const statusRes = await fetch(`${API_BASE}/api/parsing/job/${jobId}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const statusBody = await statusRes.json();
    console.log(`  [${i}] status: ${statusBody.status}`);

    if (statusBody.status === 'SUCCESS') {
      writeFileSync(join(outDir, '02-status-final.json'), JSON.stringify(statusBody, null, 2));
      break;
    }
    if (statusBody.status === 'ERROR') {
      writeFileSync(join(outDir, '02-status-error.json'), JSON.stringify(statusBody, null, 2));
      console.error('Job failed');
      process.exit(1);
    }
    await sleep(2000);
  }

  // 3. Fetch ALL result types and save raw
  const endpoints = [
    { name: 'json', path: `/api/parsing/job/${jobId}/result/json` },
    { name: 'markdown', path: `/api/parsing/job/${jobId}/result/markdown` },
    { name: 'text', path: `/api/parsing/job/${jobId}/result/text` },
    { name: 'images', path: `/api/parsing/job/${jobId}/result/images` },
  ];

  for (const ep of endpoints) {
    console.log(`Fetching ${ep.name}...`);
    try {
      const res = await fetch(`${API_BASE}${ep.path}`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const body = await res.json();
        writeFileSync(join(outDir, `03-result-${ep.name}.json`), JSON.stringify(body, null, 2));
        console.log(`  → saved 03-result-${ep.name}.json (${JSON.stringify(body).length} bytes)`);
      } else {
        const text = await res.text();
        const ext = ep.name === 'markdown' ? 'md' : 'txt';
        writeFileSync(join(outDir, `03-result-${ep.name}.${ext}`), text);
        console.log(`  → saved 03-result-${ep.name}.${ext} (${text.length} chars)`);
      }
    } catch (err: any) {
      console.log(`  → ${ep.name} failed: ${err.message}`);
    }
  }

  // 4. Also try the raw job detail endpoint
  console.log('Fetching job detail...');
  const detailRes = await fetch(`${API_BASE}/api/parsing/job/${jobId}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const detailBody = await detailRes.json();
  writeFileSync(join(outDir, '04-job-detail.json'), JSON.stringify(detailBody, null, 2));

  console.log(`\nAll raw responses saved to ${outDir}/`);
  console.log('Files:');
  console.log('  01-upload.json         — upload response');
  console.log('  02-status-final.json   — final job status');
  console.log('  03-result-json.json    — JSON result (items + layout)');
  console.log('  03-result-markdown.md  — markdown result');
  console.log('  03-result-text.txt     — plain text result');
  console.log('  03-result-images.json  — images result');
  console.log('  04-job-detail.json     — full job detail');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
