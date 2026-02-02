/**
 * Adapter bridge plugins — wrap existing pdfquery vendor adapters
 * as plugins for use with pdfquery.load().
 *
 * These are "Pattern C" plugins: pre-cached / adapter plugins.
 * They take already-parsed vendor output and produce tags, no I/O needed.
 */

import type { PDFQueryPlugin, Tag } from 'pdfquery';
import { ARTIFACT_KEYS } from '../types';
import type { OcrPage } from '../types';

// ============================================================================
// Generic adapter result shape (matches pdfquery AdapterResult)
// ============================================================================

interface AdapterResult {
  blocks: Array<{
    id: string;
    page: number;
    text: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
    type?: string;
  }>;
  tables: Array<{
    id: string;
    page: number;
    markdown: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
  pageCount: number;
}

/**
 * Convert an AdapterResult to Tag[].
 */
function adapterResultToTags(result: AdapterResult): Tag[] {
  const tags: Tag[] = [];
  for (const block of result.blocks) {
    tags.push({
      id: block.id,
      type: 'ocr',
      page: block.page,
      bbox: block.bbox,
      text: block.text,
      attrs: { confidence: block.confidence },
    });
  }
  for (const table of result.tables) {
    tags.push({
      id: table.id,
      type: 'table',
      page: table.page,
      bbox: table.bbox,
      text: table.markdown,
      attrs: { confidence: table.confidence },
    });
  }
  return tags;
}

/**
 * Convert an AdapterResult to OcrPage[] for the artifact store.
 */
function adapterResultToOcrPages(result: AdapterResult): OcrPage[] {
  const pageMap = new Map<number, OcrPage>();
  for (const block of result.blocks) {
    if (!pageMap.has(block.page)) {
      pageMap.set(block.page, { page: block.page, blocks: [], tables: [] });
    }
    pageMap.get(block.page)!.blocks.push({
      id: block.id,
      page: block.page,
      text: block.text,
      bbox: block.bbox,
      confidence: block.confidence,
      type: (block.type as 'word' | 'line' | 'paragraph') ?? undefined,
    });
  }
  for (const table of result.tables) {
    if (!pageMap.has(table.page)) {
      pageMap.set(table.page, { page: table.page, blocks: [], tables: [] });
    }
    pageMap.get(table.page)!.tables.push(table);
  }
  return Array.from(pageMap.values()).sort((a, b) => a.page - b.page);
}

// ============================================================================
// Bridge plugins
// ============================================================================

/**
 * Wrap a Google Document AI parsed result (via fromDocAI adapter) as a plugin.
 * Same name as googleOcr — fully swappable.
 */
export function fromDocAIPlugin(adapterResult: AdapterResult): PDFQueryPlugin {
  return {
    name: 'google-ocr',
    run(ctx) {
      const ocrPages = adapterResultToOcrPages(adapterResult);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
      return { tags: adapterResultToTags(adapterResult) };
    },
  };
}

/**
 * Wrap an AWS Textract parsed result (via fromTextract adapter) as a plugin.
 */
export function fromTextractPlugin(adapterResult: AdapterResult): PDFQueryPlugin {
  return {
    name: 'textract-ocr',
    run(ctx) {
      const ocrPages = adapterResultToOcrPages(adapterResult);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
      return { tags: adapterResultToTags(adapterResult) };
    },
  };
}

/**
 * Wrap an Azure Document Intelligence parsed result as a plugin.
 */
export function fromAzurePlugin(adapterResult: AdapterResult): PDFQueryPlugin {
  return {
    name: 'azure-ocr',
    run(ctx) {
      const ocrPages = adapterResultToOcrPages(adapterResult);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
      return { tags: adapterResultToTags(adapterResult) };
    },
  };
}

/**
 * Generic adapter bridge — wrap any AdapterResult as a named plugin.
 */
export function fromAdapterResult(name: string, adapterResult: AdapterResult): PDFQueryPlugin {
  return {
    name,
    run(ctx) {
      const ocrPages = adapterResultToOcrPages(adapterResult);
      ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
      return { tags: adapterResultToTags(adapterResult) };
    },
  };
}

export { adapterResultToTags, adapterResultToOcrPages };
