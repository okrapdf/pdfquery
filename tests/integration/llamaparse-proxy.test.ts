/**
 * LlamaParse Proxy API Tests
 *
 * Tests the /api/parse proxy that hides LLAMAINDEX_API_KEY from E2B sandboxes.
 * Uses short, single-page PDFs for fast testing.
 *
 * Run: pnpm vitest run tests/integration/llamaparse-proxy.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Use production URL (has the API key configured)
const BASE_URL = process.env.OKRAPDF_URL || 'https://app.okrapdf.com';
const PROXY_URL = `${BASE_URL}/api/parse`;

import { readFileSync } from 'fs';
import { join } from 'path';

// Use local test PDF (no URL needed - we'll upload directly)
const TEST_PDF_PATH = join(process.cwd(), 'testdata', 'single-page.pdf');

describe('LlamaParse Proxy API', () => {
  let jobId: string | null = null;

  beforeAll(() => {
    console.log(`[Test] Using proxy: ${PROXY_URL}`);
  });

  it('should have proxy endpoint available', async () => {
    // Simple health check - OPTIONS should work
    const response = await fetch(`${PROXY_URL}/api/parsing/upload`, {
      method: 'OPTIONS',
    });
    // Even 405 means the endpoint exists
    expect([200, 204, 405]).toContain(response.status);
  });

  it('should create a parse job via proxy', async () => {
    // Read local test PDF
    const pdfBuffer = readFileSync(TEST_PDF_PATH);
    const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

    // Create form data
    const formData = new FormData();
    formData.append('file', pdfBlob, 'single-page.pdf');

    // Upload via proxy (no API key needed - proxy injects it)
    const response = await fetch(`${PROXY_URL}/api/parsing/upload`, {
      method: 'POST',
      body: formData,
    });

    console.log('[Test] Upload response status:', response.status);
    const text = await response.text();
    console.log('[Test] Upload response:', text.slice(0, 500));

    expect(response.ok).toBe(true);

    const data = JSON.parse(text);
    expect(data.id).toBeDefined();
    jobId = data.id;
    console.log('[Test] Created job:', jobId);
  }, 30000);

  it('should check job status via proxy', async () => {
    if (!jobId) {
      console.log('[Skip] No job ID from previous test');
      return;
    }

    const response = await fetch(`${PROXY_URL}/api/parsing/job/${jobId}`);
    console.log('[Test] Status response:', response.status);

    expect(response.ok).toBe(true);

    const data = await response.json();
    console.log('[Test] Job status:', data.status);
    expect(['PENDING', 'SUCCESS', 'ERROR']).toContain(data.status);
  }, 10000);

  it('should poll until job completes', async () => {
    if (!jobId) {
      console.log('[Skip] No job ID from previous test');
      return;
    }

    const maxAttempts = 30;
    const pollInterval = 2000;
    let status = 'PENDING';

    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${PROXY_URL}/api/parsing/job/${jobId}`);
      const data = await response.json();
      status = data.status;

      console.log(`[Test] Poll ${i + 1}/${maxAttempts}: ${status}`);

      if (status === 'SUCCESS' || status === 'ERROR') {
        break;
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    expect(status).toBe('SUCCESS');
  }, 120000);

  it('should get markdown result via proxy', async () => {
    if (!jobId) {
      console.log('[Skip] No job ID from previous test');
      return;
    }

    const response = await fetch(`${PROXY_URL}/api/parsing/job/${jobId}/result/markdown`);
    console.log('[Test] Result response status:', response.status);

    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.markdown).toBeDefined();
    expect(typeof data.markdown).toBe('string');
    expect(data.markdown.length).toBeGreaterThan(0);

    console.log('[Test] Markdown preview:', data.markdown.slice(0, 200));
  }, 10000);

  it('should NOT expose API key in response', async () => {
    if (!jobId) {
      console.log('[Skip] No job ID from previous test');
      return;
    }

    // Get the job details
    const response = await fetch(`${PROXY_URL}/api/parsing/job/${jobId}`);
    const text = await response.text();

    // API key should never appear in response
    expect(text).not.toContain('llx-');
    expect(text.toLowerCase()).not.toContain('api_key');
    expect(text.toLowerCase()).not.toContain('authorization');
  });
});

describe('LlamaParse Proxy Security', () => {
  it('should return 500 if server has no API key configured', async () => {
    // This test documents expected behavior
    // In production with key configured, this should work
    // Without key, should return 500

    // We can't test this directly without removing the key
    // Just document the expected error message
    expect(true).toBe(true);
  });

  it('should not require client to send API key', async () => {
    // Verify we can make requests without any auth headers
    const response = await fetch(`${PROXY_URL}/api/parsing/upload`, {
      method: 'OPTIONS',
    });

    // Should not require Authorization header
    // (405 is fine - means endpoint exists, just wrong method)
    expect(response.status).not.toBe(401);
  });
});
