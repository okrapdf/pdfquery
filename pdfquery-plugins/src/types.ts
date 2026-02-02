/**
 * Shared types and artifact key contracts for pdfquery plugins.
 *
 * Plugins document what artifact keys they set/read.
 * This is the composition interface — producers set keys, consumers read them.
 */

import type { Tag, PageData } from 'pdfquery';
import type { PDFInput, PageImage } from 'pdfquery';

// ============================================================================
// Well-known artifact keys
// ============================================================================

export const ARTIFACT_KEYS = {
  /** PDFInput — set by source plugin, describes the input document */
  PDF_INPUT: 'pdf:input',
  /** PageImage[] — rasterized page images, set by OCR, read by VLM */
  PAGE_IMAGES: 'pages:images',
  /** OcrPage[] — structured OCR output per page, set by OCR */
  OCR_PAGES: 'ocr:pages',
  /** MarkdownPage[] — per-page markdown, set by LlamaParse / VLM markdown plugins */
  MARKDOWN_PAGES: 'markdown:pages',
  /** (tags: Tag[]) => void — inject tags back into session post-load */
  ADD_TAGS: 'add:tags',
} as const;

export type ArtifactKey = typeof ARTIFACT_KEYS[keyof typeof ARTIFACT_KEYS];

// ============================================================================
// OCR types (what OCR plugins produce)
// ============================================================================

export interface OcrBlock {
  id: string;
  page: number;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  type?: 'word' | 'line' | 'paragraph';
}

export interface OcrPage {
  page: number;
  blocks: OcrBlock[];
  tables: Array<{
    id: string;
    page: number;
    markdown: string;
    bbox: { x: number; y: number; width: number; height: number };
    confidence: number;
  }>;
}

// ============================================================================
// Plugin config types
// ============================================================================

export interface GoogleOcrConfig {
  pdf: PDFInput;
  credentials?: {
    projectId: string;
    location: string;
    processorId: string;
  };
}

export interface VlmEntityDetectConfig {
  apiKey?: string;
  model?: string;
  entityTypes?: string[];
}

export interface VlmMarkdownConfig {
  apiKey?: string;
  model?: string;
}

export interface N8nPluginConfig {
  jobId: string;
  apiBase: string;
  pollIntervalMs?: number;
}

// Re-export pdfquery types for convenience
export type { Tag, PageData, PDFInput, PageImage };
