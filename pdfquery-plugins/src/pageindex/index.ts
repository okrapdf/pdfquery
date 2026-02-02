/**
 * PageIndex AI plugin — parse PDFs via PageIndex's reasoning-based RAG.
 *
 * Submit document → poll → fetch tree structure → produce tags.
 * PageIndex returns structure-preserving markdown with page references.
 *
 * Sets artifacts:
 *   - pdf:input        (PDFInput)
 *   - ocr:pages        (OcrPage[])
 *   - pageindex:tree   (tree structure from PageIndex)
 */

import { readFile } from 'node:fs/promises';
import type { PDFQueryPlugin, Tag } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { OcrPage } from '../types';

export interface PageIndexConfig {
  /** PDF to process — file path or buffer */
  pdf: { type: 'path'; path: string } | { type: 'buffer'; data: Buffer | Uint8Array; fileName?: string };
  /** PageIndex API key — defaults to process.env.PAGEINDEX_API_KEY */
  apiKey?: string;
  /** API base URL (default: https://api.pageindex.ai) */
  apiBase?: string;
  /** Poll interval in ms (default: 3000) */
  pollIntervalMs?: number;
  /** Max wait time in ms (default: 300000 = 5min) */
  timeoutMs?: number;
}

interface PageIndexTreeNode {
  title?: string;
  content?: string;
  page?: number;
  children?: PageIndexTreeNode[];
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Flatten a PageIndex tree into page-level text blocks.
 */
function flattenTree(node: PageIndexTreeNode, tags: Tag[], pageBlocks: Map<number, string[]>) {
  const page = node.page ?? 1;
  const text = node.content || node.title || '';

  if (text) {
    if (!pageBlocks.has(page)) pageBlocks.set(page, []);
    pageBlocks.get(page)!.push(text);

    tags.push({
      id: `pi-${tags.length}`,
      type: node.children?.length ? 'heading' : 'ocr',
      page,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      text,
      attrs: { confidence: 1, source: 'pageindex' },
    });
  }

  for (const child of node.children ?? []) {
    flattenTree(child, tags, pageBlocks);
  }
}

/**
 * Create a PageIndex AI plugin.
 *
 * @example
 * ```ts
 * const doc = await pdfquery.load([
 *   pageIndex({ pdf: { type: 'path', path: './report.pdf' } }),
 * ]);
 * doc.$('ocr').contains('revenue').texts();
 * doc.artifacts.get('pageindex:tree'); // raw tree structure
 * ```
 */
export function pageIndex(config: PageIndexConfig): PDFQueryPlugin {
  const {
    apiKey = process.env.PAGEINDEX_API_KEY,
    apiBase = 'https://api.pageindex.ai',
    pollIntervalMs = 3000,
    timeoutMs = 300_000,
  } = config;

  return {
    name: 'pageindex',
    async run(ctx) {
      if (!apiKey) throw new Error('pageindex: PAGEINDEX_API_KEY not set');

      ctx.emit('pageindex:start');

      const authHeaders = {
        Authorization: `Bearer ${apiKey}`,
      };

      // 1. Upload document
      const formData = new FormData();
      let fileBlob: Blob;
      let fileName: string;

      if (config.pdf.type === 'path') {
        const data = await readFile(config.pdf.path);
        fileBlob = new Blob([new Uint8Array(data)], { type: 'application/pdf' });
        fileName = config.pdf.path.split('/').pop() || 'document.pdf';
      } else {
        fileBlob = new Blob([new Uint8Array(config.pdf.data)], { type: 'application/pdf' });
        fileName = config.pdf.fileName || 'document.pdf';
      }
      formData.append('file', fileBlob, fileName);

      const submitRes = await fetch(`${apiBase}/v1/documents`, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });
      if (!submitRes.ok) {
        const body = await submitRes.text();
        throw new Error(`pageindex submit failed: ${submitRes.status} ${body.slice(0, 200)}`);
      }
      const { doc_id: docId } = await submitRes.json() as { doc_id: string };
      ctx.emit('pageindex:submitted', { docId });

      // 2. Poll for completion
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const statusRes = await fetch(`${apiBase}/v1/documents/${docId}`, {
          headers: authHeaders,
        });
        if (!statusRes.ok) throw new Error(`pageindex status check failed: ${statusRes.status}`);
        const { status } = await statusRes.json() as { status: string };

        if (status === 'completed') break;
        if (status === 'failed' || status === 'error') throw new Error('pageindex: processing failed');

        await sleep(pollIntervalMs);
      }
      if (Date.now() >= deadline) throw new Error('pageindex: timeout');

      // 3. Fetch tree structure
      const treeRes = await fetch(`${apiBase}/v1/documents/${docId}/tree`, {
        headers: authHeaders,
      });
      if (!treeRes.ok) throw new Error(`pageindex tree fetch failed: ${treeRes.status}`);
      const treeData = await treeRes.json() as { result: PageIndexTreeNode };

      // 4. Flatten tree into tags
      const tags: Tag[] = [];
      const pageBlocks = new Map<number, string[]>();
      flattenTree(treeData.result, tags, pageBlocks);

      // 5. Build OcrPages
      const ocrPages: OcrPage[] = [];
      for (const [page, texts] of pageBlocks) {
        ocrPages.push({
          page,
          blocks: texts.map((text, i) => ({
            id: `pi-block-${page}-${i}`,
            page,
            text,
            bbox: { x: 0, y: 0, width: 1, height: 1 },
            confidence: 1,
          })),
          tables: [],
        });
      }
      ocrPages.sort((a, b) => a.page - b.page);

      ctx.artifacts.set(ARTIFACT_KEYS.PDF_INPUT, config.pdf);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
      ctx.artifacts.set('pageindex:tree', treeData.result);

      ctx.emit('pageindex:complete', { docId, tags: tags.length, pages: ocrPages.length });
      return { tags };
    },
  };
}
