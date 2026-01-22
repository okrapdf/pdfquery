import { describe, it, expect } from 'vitest';
import { fromTextract, type TextractResponse } from '../textract';
import { fromDocAI, type DocAIDocument } from '../docai';
import { fromAzure, type AzureAnalyzeResult } from '../azure';
import { fromPytesseract, type TesseractDataDict } from '../tesseract';
import { fromUnstructured, type UnstructuredElement } from '../unstructured';
import { fromDocling, type DoclingDocument } from '../docling';

import textractSample from './fixtures/textract-sample.json';
import docaiSample from './fixtures/docai-sample.json';
import azureSample from './fixtures/azure-sample.json';
import tesseractSample from './fixtures/tesseract-sample.json';
import unstructuredSample from './fixtures/unstructured-sample.json';
import doclingSample from './fixtures/docling-sample.json';

function assertNormalized(val: number, name: string) {
  expect(val, `${name} should be >= 0`).toBeGreaterThanOrEqual(0);
  expect(val, `${name} should be <= 1`).toBeLessThanOrEqual(1);
}

function assertBboxNormalized(bbox: { x: number; y: number; width: number; height: number }) {
  assertNormalized(bbox.x, 'x');
  assertNormalized(bbox.y, 'y');
  assertNormalized(bbox.width, 'width');
  assertNormalized(bbox.height, 'height');
  assertNormalized(bbox.x + bbox.width, 'x + width');
  assertNormalized(bbox.y + bbox.height, 'y + height');
}

describe('fromTextract', () => {
  it('converts Textract response to normalized blocks', () => {
    const result = fromTextract(textractSample);
    
    expect(result.pageCount).toBe(2);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.tables.length).toBe(1);
    
    for (const block of result.blocks) {
      assertBboxNormalized(block.bbox);
      expect(block.confidence).toBeGreaterThanOrEqual(0);
      expect(block.confidence).toBeLessThanOrEqual(1);
    }
    
    for (const table of result.tables) {
      assertBboxNormalized(table.bbox);
    }
  });

  it('preserves text content', () => {
    const result = fromTextract(textractSample);
    const texts = result.blocks.map(b => b.text);
    expect(texts).toContain('Total Revenue');
    expect(texts).toContain('$12,500,000');
  });
});

describe('fromDocAI', () => {
  it('converts DocAI response to normalized blocks', () => {
    const result = fromDocAI(docaiSample);
    
    expect(result.pageCount).toBe(1);
    expect(result.blocks.length).toBe(2);
    expect(result.tables.length).toBe(1);
    
    for (const block of result.blocks) {
      assertBboxNormalized(block.bbox);
    }
  });

  it('extracts text from textAnchor segments', () => {
    const result = fromDocAI(docaiSample);
    const texts = result.blocks.map(b => b.text);
    expect(texts).toContain('Invoice #12345');
  });
});

describe('fromAzure', () => {
  it('converts Azure response with pixel coords to normalized', () => {
    const result = fromAzure(azureSample as unknown as AzureAnalyzeResult);
    
    expect(result.pageCount).toBe(1);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.tables.length).toBe(1);
    
    for (const block of result.blocks) {
      assertBboxNormalized(block.bbox);
    }
    
    for (const table of result.tables) {
      assertBboxNormalized(table.bbox);
    }
  });

  it('builds markdown from table cells', () => {
    const result = fromAzure(azureSample as unknown as AzureAnalyzeResult);
    const table = result.tables[0];
    expect(table.markdown).toContain('Item');
    expect(table.markdown).toContain('Price');
    expect(table.markdown).toContain('Widget');
  });
});

describe('fromPytesseract', () => {
  it('converts pytesseract pixel coords to normalized', () => {
    const imageDimensions = { width: 1000, height: 1400 };
    const result = fromPytesseract(tesseractSample, imageDimensions);
    
    expect(result.blocks.length).toBeGreaterThan(0);
    
    for (const block of result.blocks) {
      assertBboxNormalized(block.bbox);
      expect(block.confidence).toBeGreaterThanOrEqual(0);
      expect(block.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('filters out low confidence and empty entries', () => {
    const imageDimensions = { width: 1000, height: 1400 };
    const result = fromPytesseract(tesseractSample, imageDimensions);
    
    for (const block of result.blocks) {
      expect(block.text.length).toBeGreaterThan(0);
      expect(block.confidence).toBeGreaterThan(0);
    }
  });
});

describe('fromUnstructured', () => {
  it('converts Unstructured elements to normalized blocks', () => {
    const result = fromUnstructured(unstructuredSample as unknown as UnstructuredElement[]);
    
    expect(result.pageCount).toBe(1);
    expect(result.blocks.length).toBe(2);
    expect(result.tables.length).toBe(1);
    
    for (const block of result.blocks) {
      assertBboxNormalized(block.bbox);
    }
  });

  it('converts HTML tables to markdown', () => {
    const result = fromUnstructured(unstructuredSample as unknown as UnstructuredElement[]);
    const table = result.tables[0];
    expect(table.markdown).toContain('Revenue');
    expect(table.markdown).toContain('$1M');
  });
});

describe('fromDocling', () => {
  it('converts Docling with BOTTOMLEFT origin to normalized', () => {
    const result = fromDocling(doclingSample as unknown as DoclingDocument);
    
    expect(result.pageCount).toBe(1);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.tables.length).toBe(1);
    
    for (const block of result.blocks) {
      assertBboxNormalized(block.bbox);
    }
  });

  it('flips y-coordinates correctly for BOTTOMLEFT origin', () => {
    const result = fromDocling(doclingSample as unknown as DoclingDocument);
    const header = result.blocks.find(b => b.text === 'Executive Summary');
    expect(header).toBeDefined();
    expect(header!.bbox.y).toBeLessThan(0.15);
  });

  it('includes figures with captions', () => {
    const result = fromDocling(doclingSample as unknown as DoclingDocument);
    const figure = result.blocks.find(b => b.type === 'figure');
    expect(figure).toBeDefined();
    expect(figure!.text).toBe('Revenue Growth Chart');
  });
});
