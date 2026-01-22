/**
 * Vendor adapters for normalizing OCR output to pdfquery format.
 * 
 * Each adapter converts vendor-specific JSON output to a common AdapterResult
 * with normalized 0-1 bounding boxes.
 */

// Shared types
export type { 
  NormalizedBbox, 
  NormalizedBlock, 
  NormalizedTable, 
  AdapterResult,
  ImageDimensions,
} from './types';

// AWS Textract
export { fromTextract } from './textract';
export type { TextractResponse, TextractBlock } from './textract';

// Google Document AI
export { fromDocAI } from './docai';
export type { DocAIDocument, DocAIPage } from './docai';

// Azure Document Intelligence
export { fromAzure } from './azure';
export type { AzureAnalyzeResult, AzurePage } from './azure';

// Tesseract (pytesseract and tesseract.js)
export { fromPytesseract, fromTesseractJs } from './tesseract';
export type { TesseractDataDict, TesseractJsResult } from './tesseract';

// Unstructured.io
export { fromUnstructured } from './unstructured';
export type { UnstructuredElement } from './unstructured';

// Docling (IBM)
export { fromDocling } from './docling';
export type { DoclingDocument } from './docling';
