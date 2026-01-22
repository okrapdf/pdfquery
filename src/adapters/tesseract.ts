import type { NormalizedBlock, AdapterResult, ImageDimensions } from './types';

/**
 * Tesseract adapter (via pytesseract or tesseract.js)
 * 
 * pytesseract: image_to_data(output_type=Output.DICT)
 * tesseract.js: recognize() → data.words
 * Bbox format: left, top, width, height in PIXELS
 * Normalization: Divide by image dimensions
 */

// pytesseract output format (image_to_data with DICT output)
export interface TesseractDataDict {
  level: number[];
  page_num: number[];
  block_num: number[];
  par_num: number[];
  line_num: number[];
  word_num: number[];
  left: number[];
  top: number[];
  width: number[];
  height: number[];
  conf: number[];  // -1 for non-text, 0-100 for text
  text: string[];
}

// tesseract.js output format
export interface TesseractJsWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface TesseractJsLine {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  words: TesseractJsWord[];
}

export interface TesseractJsResult {
  data: {
    text: string;
    lines: TesseractJsLine[];
  };
}

/**
 * Convert pytesseract image_to_data output
 */
export function fromPytesseract(
  data: TesseractDataDict, 
  imageDimensions: ImageDimensions
): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const { width: imgWidth, height: imgHeight } = imageDimensions;
  
  for (let i = 0; i < data.text.length; i++) {
    const text = data.text[i]?.trim();
    const conf = data.conf[i];
    
    // Skip empty text or low confidence markers
    if (!text || conf < 0) continue;
    
    const left = data.left[i];
    const top = data.top[i];
    const width = data.width[i];
    const height = data.height[i];
    const level = data.level[i];
    
    // level: 1=page, 2=block, 3=paragraph, 4=line, 5=word
    let type: NormalizedBlock['type'];
    if (level === 4) type = 'line';
    else if (level === 5) type = 'word';
    else if (level === 3) type = 'paragraph';
    else continue; // Skip page/block level containers
    
    blocks.push({
      id: `tess-${data.page_num[i]}-${data.block_num[i]}-${data.line_num[i]}-${data.word_num[i]}`,
      page: data.page_num[i],
      text,
      bbox: {
        x: left / imgWidth,
        y: top / imgHeight,
        width: width / imgWidth,
        height: height / imgHeight,
      },
      confidence: conf / 100,
      type,
    });
  }
  
  return {
    blocks,
    tables: [],
    pageCount: Math.max(...data.page_num, 1),
  };
}

/**
 * Convert tesseract.js recognize() output
 */
export function fromTesseractJs(
  result: TesseractJsResult,
  imageDimensions: ImageDimensions,
  pageNumber = 1
): AdapterResult {
  const blocks: NormalizedBlock[] = [];
  const { width: imgWidth, height: imgHeight } = imageDimensions;
  
  let lineId = 0;
  for (const line of result.data.lines) {
    // Add line-level block
    blocks.push({
      id: `tessjs-line-${lineId}`,
      page: pageNumber,
      text: line.text,
      bbox: {
        x: line.bbox.x0 / imgWidth,
        y: line.bbox.y0 / imgHeight,
        width: (line.bbox.x1 - line.bbox.x0) / imgWidth,
        height: (line.bbox.y1 - line.bbox.y0) / imgHeight,
      },
      confidence: line.confidence / 100,
      type: 'line',
    });
    
    // Add word-level blocks
    let wordId = 0;
    for (const word of line.words) {
      blocks.push({
        id: `tessjs-line-${lineId}-word-${wordId}`,
        page: pageNumber,
        text: word.text,
        bbox: {
          x: word.bbox.x0 / imgWidth,
          y: word.bbox.y0 / imgHeight,
          width: (word.bbox.x1 - word.bbox.x0) / imgWidth,
          height: (word.bbox.y1 - word.bbox.y0) / imgHeight,
        },
        confidence: word.confidence / 100,
        type: 'word',
      });
      wordId++;
    }
    lineId++;
  }
  
  return {
    blocks,
    tables: [],
    pageCount: 1,
  };
}
