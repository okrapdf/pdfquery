// Types & artifact keys
export { ARTIFACT_KEYS } from './types';
export type {
  ArtifactKey,
  OcrBlock,
  OcrPage,
  GoogleOcrConfig,
  VlmEntityDetectConfig,
  VlmMarkdownConfig,
  N8nPluginConfig,
} from './types';

// Plugin factories
export { googleOcr, ocrPagesToTags } from './google-ocr';
export { vlmEntityDetect } from './vlm-entity-detect';
export { vlmMarkdown } from './vlm-markdown';

// PyMuPDF local extraction (real I/O plugin)
export { pymupdf, PYMUPDF_ARTIFACT_KEYS } from './pymupdf';
export type { PyMuPDFConfig, TocEntry } from './pymupdf';

// HTML serializer (document tree → openable HTML file)
export { serializeHTML } from './serialize-html';

// VLM Bbox Detect (VLM-based entity detection with bounding boxes)
export { vlmBboxDetect } from './vlm-bbox-detect';
export type { VLMBboxDetectConfig } from './vlm-bbox-detect';

// VLM OpenRouter (vision model queries via OpenRouter)
export { vlmOpenRouter, highlightRegion, cropImage } from './vlm-openrouter';
export type { VLMOpenRouterConfig } from './vlm-openrouter';

// LlamaParse (LlamaIndex Cloud API)
export { llamaParse, processJsonResult } from './llamaparse';
export type { LlamaParseConfig, MarkdownPage } from './llamaparse';

// OkraPDF OCR (via OkraPDF API)
export { okraOcr } from './okra-ocr';
export type { OkraOcrConfig } from './okra-ocr';

// Docling Serve (self-hosted IBM docling REST API)
export { doclingServe } from './docling-serve';
export type { DoclingServeConfig } from './docling-serve';

// PageIndex AI (reasoning-based RAG)
export { pageIndex } from './pageindex';
export type { PageIndexConfig } from './pageindex';

// Adapter bridges (wrap existing vendor adapters as plugins)
export {
  fromDocAIPlugin,
  fromTextractPlugin,
  fromAzurePlugin,
  fromAdapterResult,
  adapterResultToTags,
  adapterResultToOcrPages,
} from './adapter-bridges';
