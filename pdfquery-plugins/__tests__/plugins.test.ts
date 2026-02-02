import { describe, it, expect, vi } from 'vitest';
import { pdfquery } from 'pdfquery';
import sharp from 'sharp';
import type { PDFQueryPlugin, Tag, VLMImage } from 'pdfquery';
import {
  ARTIFACT_KEYS,
  googleOcr,
  vlmEntityDetect,
  vlmMarkdown,
  vlmBboxDetect,
  fromDocAIPlugin,
  fromAdapterResult,
  highlightRegion,
  cropImage,
} from '../src';
import type { OcrPage, PageImage } from '../src/types';

// ============================================================================
// Helpers
// ============================================================================

function makeTag(id: string, type: string, page: number, text?: string): Tag {
  return {
    id,
    type,
    page,
    bbox: { x: 0, y: 0, width: 0.5, height: 0.1 },
    text,
  };
}

function makeAdapterResult() {
  return {
    blocks: [
      { id: 'b1', page: 1, text: 'Hello world', bbox: { x: 0, y: 0, width: 0.5, height: 0.05 }, confidence: 0.95 },
      { id: 'b2', page: 1, text: 'Second line', bbox: { x: 0, y: 0.1, width: 0.5, height: 0.05 }, confidence: 0.9 },
      { id: 'b3', page: 2, text: 'Page two', bbox: { x: 0, y: 0, width: 0.5, height: 0.05 }, confidence: 0.88 },
    ],
    tables: [
      { id: 't1', page: 1, markdown: '| A | B |\n|---|---|\n| 1 | 2 |', bbox: { x: 0, y: 0.5, width: 1, height: 0.3 }, confidence: 0.92 },
    ],
    pageCount: 2,
  };
}

// ============================================================================
// Artifacts flow between plugins
// ============================================================================

describe('artifacts flow', () => {
  it('artifacts are shared between dependent plugins', async () => {
    const ocrPages: OcrPage[] = [
      { page: 1, blocks: [{ id: 'b1', page: 1, text: 'test', bbox: { x: 0, y: 0, width: 0.5, height: 0.1 }, confidence: 0.9 }], tables: [] },
    ];
    const pageImages: PageImage[] = [
      { page: 1, data: new Uint8Array([1, 2, 3]), mimeType: 'image/png', width: 100, height: 100 },
    ];

    const producer: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, ocrPages);
        return {
          tags: [makeTag('ocr-1', 'ocr', 1, 'test')],
        };
      },
    };

    let receivedImages: PageImage[] | undefined;
    let receivedPages: OcrPage[] | undefined;

    const consumer: PDFQueryPlugin = {
      name: 'vlm-entity-detect',
      depends: ['google-ocr'],
      run(ctx) {
        receivedImages = ctx.artifacts.get(ARTIFACT_KEYS.PAGE_IMAGES) as PageImage[];
        receivedPages = ctx.artifacts.get(ARTIFACT_KEYS.OCR_PAGES) as OcrPage[];
        return {
          tags: [makeTag('entity-1', 'table', 1, 'detected table')],
        };
      },
    };

    const doc = await pdfquery.load([producer, consumer]);

    expect(receivedImages).toBe(pageImages);
    expect(receivedPages).toBe(ocrPages);
    expect(doc.$('ocr').count()).toBe(1);
    expect(doc.$('table').count()).toBe(1);
    // +1 synthetic page entity per page
    expect(doc.$('*').count()).toBe(3);
  });

  it('artifacts persist on session after load', async () => {
    const producer: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set('test:key', 42);
        return { tags: [] };
      },
    };

    const doc = await pdfquery.load([producer]);
    expect(doc.artifacts.get('test:key')).toBe(42);
  });
});

// ============================================================================
// pdfquery.load()
// ============================================================================

describe('pdfquery.load()', () => {
  it('runs plugins and merges tags', async () => {
    const plugin: PDFQueryPlugin = {
      name: 'test-source',
      run() {
        return {
          tags: [
            makeTag('p1', 'table', 1, 'Table data'),
            makeTag('p2', 'figure', 1, 'Chart'),
          ],
        };
      },
    };

    const doc = await pdfquery.load([plugin]);
    expect(doc.$('table').count()).toBe(1);
    expect(doc.$('figure').count()).toBe(1);
    expect(doc.$('*').count()).toBe(3);
  });

  it('load with pre-existing tags merges both', async () => {
    const plugin: PDFQueryPlugin = {
      name: 'enricher',
      run() {
        return {
          tags: [makeTag('enriched', 'footnote', 1, 'Note')],
        };
      },
    };

    const doc = await pdfquery.load([plugin], {
      tags: [makeTag('existing', 'table', 1, 'Existing table')],
    });

    expect(doc.$('table').count()).toBe(1);
    expect(doc.$('footnote').count()).toBe(1);
    expect(doc.$('*').count()).toBe(3);
  });

  it('load with no plugins returns empty session', async () => {
    const doc = await pdfquery.load([]);
    expect(doc.$('*').count()).toBe(0);
  });

  it('dependency order is respected', async () => {
    const order: string[] = [];

    const pluginA: PDFQueryPlugin = {
      name: 'source',
      run() {
        order.push('source');
        return { tags: [] };
      },
    };

    const pluginB: PDFQueryPlugin = {
      name: 'transform',
      depends: ['source'],
      run() {
        order.push('transform');
        return { tags: [] };
      },
    };

    // Deliberately pass in reverse order
    await pdfquery.load([pluginB, pluginA]);
    expect(order).toEqual(['source', 'transform']);
  });
});

// ============================================================================
// session.load() (instance method)
// ============================================================================

describe('session.load()', () => {
  it('runs plugins added after data via load()', async () => {
    let runCount = 0;
    const plugin: PDFQueryPlugin = {
      name: 'enricher',
      run(ctx) {
        runCount++;
        const count = ctx.$('table').count();
        return {
          tags: [makeTag(`enriched-${runCount}`, 'footnote', 1, `Found ${count} tables`)],
        };
      },
    };

    // Use pdfquery.load (the recommended path) for clean single-run behavior
    const doc = await pdfquery.load([plugin], {
      tags: [makeTag('t1', 'table', 1, 'Revenue')],
    });

    expect(doc.$('table').count()).toBe(1);
    expect(doc.$('footnote').count()).toBe(1);
    expect(doc.$('footnote').texts()).toEqual(['Found 1 tables']);
  });

  it('instance load() on session with no plugins is noop', async () => {
    const doc = pdfquery();
    doc.addTags([makeTag('t1', 'table', 1, 'Revenue')]);
    await doc.load();
    expect(doc.$('table').count()).toBe(1);
  });

  it('returns this for chaining', async () => {
    const doc = pdfquery();
    const result = await doc.load();
    expect(result).toBe(doc);
  });
});

// ============================================================================
// Same-name plugins are swappable
// ============================================================================

describe('plugin swappability', () => {
  it('local and adapter versions produce same-name plugin', () => {
    const local = googleOcr({ pdf: { type: 'buffer', data: new Uint8Array() } });
    const cached = fromDocAIPlugin(makeAdapterResult());

    expect(local.name).toBe('google-ocr');
    expect(cached.name).toBe('google-ocr');
  });

  it('cached adapter plugin produces queryable tags', async () => {
    const doc = await pdfquery.load([fromDocAIPlugin(makeAdapterResult())]);

    expect(doc.$('ocr').count()).toBe(3);
    expect(doc.$('table').count()).toBe(1);
    // +2 synthetic page entities (pages 1 and 2)
    expect(doc.$('*').count()).toBe(6);
  });

  it('generic adapter bridge works with custom name', async () => {
    const doc = await pdfquery.load([
      fromAdapterResult('custom-ocr', makeAdapterResult()),
    ]);

    expect(doc.$('ocr').count()).toBe(3);
    expect(doc.$('table').count()).toBe(1);
  });

  it('adapter bridge sets OCR_PAGES artifact', async () => {
    const doc = await pdfquery.load([fromDocAIPlugin(makeAdapterResult())]);

    const ocrPages = doc.artifacts.get(ARTIFACT_KEYS.OCR_PAGES) as OcrPage[];
    expect(ocrPages).toBeDefined();
    expect(ocrPages.length).toBe(2); // 2 pages in adapter result
    expect(ocrPages[0].blocks.length).toBe(2); // 2 blocks on page 1
    expect(ocrPages[1].blocks.length).toBe(1); // 1 block on page 2
  });
});

// ============================================================================
// Skeleton plugins (googleOcr, vlmEntityDetect, vlmMarkdown)
// ============================================================================

describe('skeleton plugins', () => {
  it('googleOcr skeleton sets PDF_INPUT artifact', async () => {
    const pdfInput = { type: 'buffer' as const, data: new Uint8Array([1]) };
    const doc = await pdfquery.load([googleOcr({ pdf: pdfInput })]);

    expect(doc.artifacts.get(ARTIFACT_KEYS.PDF_INPUT)).toBe(pdfInput);
  });

  it('vlmEntityDetect skips when no page images', async () => {
    const emitSpy = vi.fn();

    // Source that sets no page images
    const source: PDFQueryPlugin = {
      name: 'google-ocr',
      run() { return { tags: [] }; },
    };

    const doc = pdfquery();
    doc.use(source);
    doc.use(vlmEntityDetect());
    doc.on('vlm-entity-detect:skip', emitSpy);
    await doc.load();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('vlmMarkdown skips when no page images', async () => {
    const emitSpy = vi.fn();

    const source: PDFQueryPlugin = {
      name: 'google-ocr',
      run() { return { tags: [] }; },
    };

    const doc = pdfquery();
    doc.use(source);
    doc.use(vlmMarkdown());
    doc.on('vlm-markdown:skip', emitSpy);
    await doc.load();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('full pipeline: OCR → entity detect → markdown', async () => {
    const pageImages: PageImage[] = [
      { page: 1, data: new Uint8Array([1]), mimeType: 'image/png', width: 100, height: 100 },
    ];

    // Custom OCR that produces page images
    const ocr: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, []);
        return { tags: [makeTag('b1', 'ocr', 1, 'text')] };
      },
    };

    const doc = await pdfquery.load([ocr, vlmEntityDetect(), vlmMarkdown()]);

    // Skeleton plugins produce no tags of their own, but pipeline runs without error
    expect(doc.$('ocr').count()).toBe(1);
    expect(doc.$('*').count()).toBe(2);
  });
});

// ============================================================================
// vlm() with images from source plugin
// ============================================================================

describe('vlm() with images from source plugin', () => {
  const pageImages: PageImage[] = [
    { page: 1, data: new Uint8Array([10, 20]), mimeType: 'image/png', width: 800, height: 600 },
    { page: 2, data: new Uint8Array([30, 40]), mimeType: 'image/png', width: 800, height: 600 },
    { page: 3, data: new Uint8Array([50, 60]), mimeType: 'image/png', width: 800, height: 600 },
  ];

  /** Fake OCR source that sets page images + tags with known bboxes */
  function fakeOcr(): PDFQueryPlugin {
    return {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, []);
        return {
          tags: [
            // Two ocr blocks on page 1 at different positions
            { id: 'b1', type: 'ocr', page: 1, bbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 }, text: 'Revenue was $10B' },
            { id: 'b2', type: 'ocr', page: 1, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.05 }, text: 'Net income $2B' },
            // Table on page 1 with a specific bbox
            { id: 't1', type: 'table', page: 1, bbox: { x: 0.05, y: 0.4, width: 0.9, height: 0.3 }, text: '| Q1 | Q2 |' },
            // Blocks on other pages
            { id: 'b3', type: 'ocr', page: 2, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, text: 'Risk factors' },
            { id: 'b4', type: 'ocr', page: 3, bbox: { x: 0.0, y: 0.0, width: 0.4, height: 0.08 }, text: 'Appendix' },
          ],
        };
      },
    };
  }

  /** Mock vlm plugin that records calls instead of hitting OpenRouter */
  function fakeVlm(calls: Array<{ images: VLMImage[]; prompt: string }>) {
    const plugin: PDFQueryPlugin = {
      name: 'vlm-openrouter',
      run(ctx) {
        const handler = async (images: VLMImage[], prompt: string): Promise<string> => {
          calls.push({ images, prompt });
          return `mock response for ${images.length} image(s)`;
        };
        ctx.artifacts.set('vlm:call', handler);
        return {};
      },
    };
    return plugin;
  }

  it('vlm:call artifact is set by vlm plugin', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    expect(doc.artifacts.get('vlm:call')).toBeDefined();
    expect(typeof doc.artifacts.get('vlm:call')).toBe('function');
  });

  it('$("page:first").vlm() sends full page image without crop', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    const result = await doc.$('page:first').vlm('what is this page about?');

    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe('what is this page about?');
    expect(calls[0].images).toHaveLength(1);
    expect(calls[0].images[0].image.page).toBe(1);
    // Page selection → no crop (full page)
    expect(calls[0].images[0].crop).toBeUndefined();
    expect(result).toBe('mock response for 1 image(s)');
  });

  it('$("table").vlm() sends image cropped to table bbox', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    await doc.$('table').vlm('extract dollar amounts');

    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1);
    expect(calls[0].images[0].image.page).toBe(1);
    // Crop should match the table's bbox {x:0.05, y:0.4, w:0.9, h:0.3}
    expect(calls[0].images[0].crop).toBeDefined();
    expect(calls[0].images[0].crop!.xmin).toBeCloseTo(0.05);
    expect(calls[0].images[0].crop!.ymin).toBeCloseTo(0.4);
    expect(calls[0].images[0].crop!.xmax).toBeCloseTo(0.95); // 0.05 + 0.9
    expect(calls[0].images[0].crop!.ymax).toBeCloseTo(0.7);  // 0.4 + 0.3
  });

  it('$("ocr").onPage(2).vlm() sends page 2 image cropped to block bbox', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    await doc.$('ocr').onPage(2).vlm('summarize');

    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1);
    expect(calls[0].images[0].image.page).toBe(2);
    // Crop should match b3's bbox {x:0.1, y:0.1, w:0.5, h:0.1}
    expect(calls[0].images[0].crop).toBeDefined();
    expect(calls[0].images[0].crop!.xmin).toBeCloseTo(0.1);
    expect(calls[0].images[0].crop!.ymin).toBeCloseTo(0.1);
    expect(calls[0].images[0].crop!.xmax).toBeCloseTo(0.6); // 0.1 + 0.5
    expect(calls[0].images[0].crop!.ymax).toBeCloseTo(0.2); // 0.1 + 0.1
  });

  it('multi-element selection computes union bbox per page', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    // Two ocr blocks on page 1: b1 at (0.1,0.1)-(0.4,0.15), b2 at (0.1,0.2)-(0.4,0.25)
    await doc.$('ocr').onPage(1).vlm('describe this section');

    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1);
    // Union bbox should span both blocks
    expect(calls[0].images[0].crop).toBeDefined();
    expect(calls[0].images[0].crop!.xmin).toBeCloseTo(0.1);
    expect(calls[0].images[0].crop!.ymin).toBeCloseTo(0.1);
    expect(calls[0].images[0].crop!.xmax).toBeCloseTo(0.4);  // max of both xmax
    expect(calls[0].images[0].crop!.ymax).toBeCloseTo(0.25); // max of both ymax
  });

  it('multi-page selection sends one VLMImage per page with crop', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    await doc.$('ocr').vlm('describe all pages');

    expect(calls).toHaveLength(1);
    // 3 pages (deduplicated)
    expect(calls[0].images).toHaveLength(3);
    const sentPages = calls[0].images.map(i => i.image.page);
    expect(sentPages).toEqual([1, 2, 3]);
    // Each should have a crop (non-page entity selection)
    for (const img of calls[0].images) {
      expect(img.crop).toBeDefined();
    }
  });

  it('throws when vlm plugin not loaded', async () => {
    const doc = await pdfquery.load([fakeOcr()]);

    await expect(doc.$('page:first').vlm('test'))
      .rejects.toThrow('vlm plugin not loaded');
  });

  it('throws when no page images available', async () => {
    const noImagesOcr: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, []);
        return { tags: [makeTag('b1', 'ocr', 1, 'text')] };
      },
    };
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([noImagesOcr, fakeVlm(calls)]);

    await expect(doc.$('ocr').vlm('test'))
      .rejects.toThrow('No page images');
  });

  it('handler receives original image ref (no copy)', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    await doc.$('page:first').vlm('test');

    expect(calls[0].images[0].image).toBe(pageImages[0]);
  });

  // --------------------------------------------------------------------------
  // .getCss() — read back stored CSS props
  // --------------------------------------------------------------------------

  it('.getCss() returns props set via .css()', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    const styled = doc.$('table').css({ borderColor: 'red', borderWidth: 3, fill: 'rgba(255,0,0,0.08)' });
    const css = styled.getCss();

    expect(css.borderColor).toBe('red');
    expect(css.borderWidth).toBe(3);
    expect(css.fill).toBe('rgba(255,0,0,0.08)');
  });

  it('.getCss() returns empty object when no .css() called', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    const css = doc.$('table').getCss();
    expect(css).toEqual({});
  });

  it('.getCss() merges multiple .css() calls', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    const styled = doc.$('table')
      .css({ borderColor: 'red' })
      .css({ fill: 'rgba(0,200,0,0.06)' });

    const css = styled.getCss();
    expect(css.borderColor).toBe('red');
    expect(css.fill).toBe('rgba(0,200,0,0.06)');
  });

  // --------------------------------------------------------------------------
  // consumer-side renderOverlay — composites styled selections onto page image
  // --------------------------------------------------------------------------

  it('consumer renderOverlay: styled selections produce correct dimensions', async () => {
    const realPng = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).png().toBuffer();

    const realPageImages: PageImage[] = [
      { page: 1, data: realPng, mimeType: 'image/png', width: 800, height: 600 },
    ];

    const ocrPlugin: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, realPageImages);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, []);
        return {
          tags: [
            { id: 't1', type: 'table', page: 1, bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }, text: '| A | B |', attrs: { source: 'ocr' } },
            { id: 't2', type: 'table', page: 1, bbox: { x: 0.2, y: 0.7, width: 0.5, height: 0.2 }, text: '| C | D |', attrs: { source: 'vlm-bbox' } },
          ],
        };
      },
    };

    const doc = await pdfquery.load([ocrPlugin]);
    const pageImg = realPageImages[0];

    // Style selections (consumer reads getCss() to drive highlightRegion)
    const selections = [
      doc.$('table').not('[source=vlm-bbox]').css({ borderColor: 'red' }),
      doc.$('table[source=vlm-bbox]').css({ borderColor: 'green', fill: 'rgba(0,200,0,0.06)' }),
    ];

    // Consumer-side renderOverlay logic
    let buf = Buffer.from(pageImg.data);
    for (const sel of selections) {
      const css = sel.getCss();
      for (const el of sel.elements) {
        buf = await highlightRegion(buf, pageImg.width, pageImg.height, el.bbox, {
          stroke: (css.borderColor as string) ?? '#ff0000',
          strokeWidth: (css.borderWidth as number) ?? 3,
          fill: (css.fill as string) ?? 'rgba(255,0,0,0.08)',
        });
      }
    }

    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  // --------------------------------------------------------------------------
  // .css({ margin }) — expand crop region
  // --------------------------------------------------------------------------

  it('.css({ margin: 20 }) expands crop by 20px on all sides', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    // Table bbox: {x:0.05, y:0.4, w:0.9, h:0.3}
    //   → normalized: {xmin:0.05, ymin:0.4, xmax:0.95, ymax:0.7}
    // Image: 800×600
    // 20px margin → x: 20/800 = 0.025, y: 20/600 ≈ 0.0333
    await doc.$('table').css({ margin: 20 }).vlm('extract amounts');

    const crop = calls[0].images[0].crop!;
    expect(crop.xmin).toBeCloseTo(0.05 - 20 / 800);  // 0.025
    expect(crop.ymin).toBeCloseTo(0.4 - 20 / 600);   // 0.3667
    expect(crop.xmax).toBeCloseTo(0.95 + 20 / 800);  // 0.975
    expect(crop.ymax).toBeCloseTo(0.7 + 20 / 600);   // 0.7333

    // Resulting crop dimensions in pixels
    const cropW = (crop.xmax - crop.xmin) * 800;
    const cropH = (crop.ymax - crop.ymin) * 600;
    // Original table: 0.9*800=720px wide, 0.3*600=180px tall
    // With 20px margin each side: 720+40=760px, 180+40=220px
    expect(cropW).toBeCloseTo(760);
    expect(cropH).toBeCloseTo(220);
  });

  it('.css({ margin: "10px 30px" }) applies asymmetric vertical/horizontal', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    // margin: 10px 30px → top/bottom: 10px, left/right: 30px
    await doc.$('table').css({ margin: '10px 30px' }).vlm('test');

    const crop = calls[0].images[0].crop!;
    expect(crop.xmin).toBeCloseTo(0.05 - 30 / 800);
    expect(crop.ymin).toBeCloseTo(0.4 - 10 / 600);
    expect(crop.xmax).toBeCloseTo(0.95 + 30 / 800);
    expect(crop.ymax).toBeCloseTo(0.7 + 10 / 600);

    const cropW = (crop.xmax - crop.xmin) * 800;
    const cropH = (crop.ymax - crop.ymin) * 600;
    // 720 + 60 = 780px wide, 180 + 20 = 200px tall
    expect(cropW).toBeCloseTo(780);
    expect(cropH).toBeCloseTo(200);
  });

  it('.css({ margin }) clamps to page bounds [0,1]', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    // table xmax is already 0.95, adding 200px/800=0.25 would exceed 1.0
    await doc.$('table').css({ margin: 200 }).vlm('test');

    const crop = calls[0].images[0].crop!;
    expect(crop.xmin).toBe(0);                       // clamped: 0.05 - 200/800 = -0.2 → 0
    expect(crop.ymin).toBeCloseTo(0.4 - 200 / 600);  // 0.067 (not clamped)
    expect(crop.xmax).toBe(1);                       // clamped: 0.95 + 200/800 = 1.2 → 1
    expect(crop.ymax).toBe(1);                       // clamped: 0.7 + 200/600 = 1.03 → 1
  });

  it('.css({ margin }) on page selection is noop (no crop)', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];
    const doc = await pdfquery.load([fakeOcr(), fakeVlm(calls)]);

    await doc.$('page:first').css({ margin: 50 }).vlm('test');

    // Page selections never have crop, regardless of margin
    expect(calls[0].images[0].crop).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // highlightRegion / cropImage — sharp image operations
  // --------------------------------------------------------------------------

  it('highlightRegion preserves full page dimensions', async () => {
    const src = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();

    const result = await highlightRegion(src, 800, 600, {
      xmin: 0.1, ymin: 0.2, xmax: 0.9, ymax: 0.6,
    });

    const meta = await sharp(result).metadata();
    // Same dimensions — highlight is additive, not destructive
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('cropImage crops to correct pixel dimensions', async () => {
    const src = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toBuffer();

    const result = await cropImage(src, 800, 600, {
      xmin: 0.25, ymin: 0.25, xmax: 0.75, ymax: 0.75,
    });

    const meta = await sharp(result.data).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('end-to-end: .css({ margin: 20 }) highlights region on full page', async () => {
    const realPng = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 128, g: 128, b: 128 } },
    }).png().toBuffer();

    const realPageImages: PageImage[] = [
      { page: 1, data: realPng, mimeType: 'image/png', width: 800, height: 600 },
    ];

    const ocrPlugin: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, realPageImages);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, []);
        return {
          tags: [
            { id: 't1', type: 'table', page: 1, bbox: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }, text: '| A | B |' },
          ],
        };
      },
    };

    // VLM plugin that highlights via sharp (like the real vlmOpenRouter)
    const outputBuffers: Buffer[] = [];
    const vlmPlugin: PDFQueryPlugin = {
      name: 'vlm-openrouter',
      run(ctx) {
        const handler = async (images: VLMImage[]): Promise<string> => {
          for (const { image: img, crop } of images) {
            if (crop) {
              const buf = await highlightRegion(img.data, img.width, img.height, crop);
              outputBuffers.push(buf);
            }
          }
          return 'ok';
        };
        ctx.artifacts.set('vlm:call', handler);
        return {};
      },
    };

    const doc = await pdfquery.load([ocrPlugin, vlmPlugin]);
    await doc.$('table').css({ margin: 20 }).vlm('extract data');

    expect(outputBuffers).toHaveLength(1);
    const meta = await sharp(outputBuffers[0]).metadata();

    // Full page dimensions preserved — highlight is additive
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });
});

// ============================================================================
// ARTIFACT_KEYS contract
// ============================================================================

describe('ARTIFACT_KEYS', () => {
  it('has expected keys', () => {
    expect(ARTIFACT_KEYS.PDF_INPUT).toBe('pdf:input');
    expect(ARTIFACT_KEYS.PAGE_IMAGES).toBe('pages:images');
    expect(ARTIFACT_KEYS.OCR_PAGES).toBe('ocr:pages');
  });
});

// ============================================================================
// Multi-source overlapping tags: OCR + VLM bbox detection
//
// jQuery analogy: jQuery never deduplicates DOM nodes from different sources.
// $('div') returns ALL divs regardless of visual overlap. Consumers
// reconcile via .filter(), .not(), .has(). Same philosophy here.
//
// unstructured.io takes the opposite approach: 5-rule merge with IoU
// thresholds (same-region → keep inferred classification + extracted text,
// subregion → merge into parent, table regions always win). That's a
// deliberate design choice for their hi_res partition strategy.
//
// pdfquery layers by default — tests below discover + verify this behavior.
// ============================================================================

describe('multi-source overlapping tags (OCR + VLM bbox detect)', () => {
  const pageImages: PageImage[] = [
    { page: 1, data: new Uint8Array([10, 20]), mimeType: 'image/png', width: 800, height: 1000 },
    { page: 2, data: new Uint8Array([30, 40]), mimeType: 'image/png', width: 800, height: 1000 },
  ];

  /**
   * Simulates an OCR source (e.g. DocAI, PyMuPDF) that extracts tables from
   * the PDF's native text layer. These bboxes come from PDF coordinates.
   */
  function ocrSource(): PDFQueryPlugin {
    return {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
        ctx.artifacts.set(ARTIFACT_KEYS.OCR_PAGES, []);
        return {
          tags: [
            // OCR-detected table — bbox from PDF text extraction
            {
              id: 'ocr-t1', type: 'table', page: 1,
              bbox: { x: 0.05, y: 0.40, width: 0.90, height: 0.30 },
              text: '| Revenue | 10B |\n| Net Income | 2B |',
              attrs: { source: 'ocr', confidence: 0.92 },
            },
            // OCR-detected figure
            {
              id: 'ocr-f1', type: 'figure', page: 1,
              bbox: { x: 0.10, y: 0.75, width: 0.60, height: 0.20 },
              text: 'Bar chart showing quarterly growth',
              attrs: { source: 'ocr', confidence: 0.85 },
            },
            // Table on page 2 (no VLM overlap — only OCR sees it)
            {
              id: 'ocr-t2', type: 'table', page: 2,
              bbox: { x: 0.10, y: 0.20, width: 0.80, height: 0.25 },
              text: '| Q1 | Q2 | Q3 |',
              attrs: { source: 'ocr', confidence: 0.88 },
            },
            // OCR text blocks
            {
              id: 'ocr-b1', type: 'ocr', page: 1,
              bbox: { x: 0.05, y: 0.05, width: 0.50, height: 0.05 },
              text: 'Financial Highlights',
              attrs: { source: 'ocr', confidence: 0.99 },
            },
          ],
        };
      },
    };
  }

  /**
   * Mock VLM handler that returns canned JSON detections.
   * On page 1: detects same table with slightly different bbox + a new figure.
   * On page 2: detects nothing (empty array).
   */
  function vlmHandler(): PDFQueryPlugin {
    return {
      name: 'vlm-openrouter',
      run(ctx) {
        const handler = async (images: Array<{ image: PageImage }>, _prompt: string): Promise<string> => {
          const page = images[0]?.image.page;
          if (page === 1) {
            return JSON.stringify([
              {
                type: 'table',
                // Overlapping but slightly different bbox (VLM drew it bigger)
                bbox: { x: 0.03, y: 0.38, width: 0.94, height: 0.34 },
                description: 'Financial results table with revenue and income',
                confidence: 0.87,
              },
              {
                type: 'figure',
                // Same figure, nearly identical bbox
                bbox: { x: 0.11, y: 0.76, width: 0.59, height: 0.19 },
                description: 'Quarterly growth bar chart',
                confidence: 0.91,
              },
            ]);
          }
          return '[]'; // Nothing detected on page 2
        };
        ctx.artifacts.set('vlm:call', handler);
        return {};
      },
    };
  }

  // --------------------------------------------------------------------------
  // jQuery principle: layering, not deduplication
  //
  // In jQuery: two <table> elements with overlapping CSS positions are both
  // returned by $('table'). They have different DOM identities.
  // Same here: each plugin's tags have different IDs, both queryable.
  // --------------------------------------------------------------------------

  it('both sources produce tags — no dedup, all coexist', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // jQuery: $('table').length === 3 (2 from OCR + 1 from VLM on page 1)
    // OCR gives: ocr-t1 (p1), ocr-t2 (p2)
    // VLM gives: vlm-bbox-p1-table-0 (p1)
    expect(doc.$('table').count()).toBe(3);

    // jQuery: $('figure').length === 2 (1 OCR + 1 VLM)
    expect(doc.$('figure').count()).toBe(2);
  });

  it('filter by source — jQuery .filter() analog', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // jQuery: $('table').filter('[data-source=ocr]')
    const ocrTables = doc.$('table[source=ocr]');
    expect(ocrTables.count()).toBe(2);

    // jQuery: $('table').filter('[data-source=vlm-bbox]')
    const vlmTables = doc.$('table[source=vlm-bbox]');
    expect(vlmTables.count()).toBe(1);

    // Different text content — OCR has markdown, VLM has description
    expect(ocrTables.onPage(1).texts()[0]).toContain('Revenue');
    expect(vlmTables.texts()[0]).toContain('Financial results');
  });

  it('overlapping bboxes on same page — both visible to spatial queries', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // The OCR text block "Financial Highlights" is at y=0.05
    // Both tables start around y=0.38-0.40
    // .below() should find BOTH overlapping tables from the heading
    const heading = doc.$('#ocr-b1');
    expect(heading.count()).toBe(1);

    const below = heading.below({ maxDistance: 0.5 });
    // Should find both OCR and VLM tables (overlapping), plus the figure
    const tablesBelowHeading = below.filter('table');
    expect(tablesBelowHeading.count()).toBe(2); // ocr-t1 + vlm table
  });

  it('.near() returns overlapping tags from both sources', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // OCR table center: (0.50, 0.55) — bbox {0.05, 0.40, 0.90, 0.30}
    // VLM table center: (0.50, 0.55) — bbox {0.03, 0.38, 0.94, 0.34}
    // These centers are nearly identical → .near(0.05) should find one from the other
    const ocrTable = doc.$('#ocr-t1');
    const nearby = ocrTable.near(0.05);

    // The VLM-detected table overlaps, so it should be near
    const nearbyTables = nearby.filter('table');
    expect(nearbyTables.count()).toBeGreaterThanOrEqual(1);
    // The nearby table should be the VLM one (OCR table is excluded as "self")
    expect(nearbyTables.filter('[source=vlm-bbox]').count()).toBe(1);
  });

  it('$("table").onPage(1) returns both overlapping tags', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    const tablesP1 = doc.$('table').onPage(1);
    expect(tablesP1.count()).toBe(2); // OCR + VLM

    // They have different IDs
    const ids = tablesP1.elements.map(e => e.id);
    expect(ids).toContain('ocr-t1');
    expect(ids.find(id => id.startsWith('vlm-bbox-'))).toBeDefined();
  });

  it('page with only OCR tags (no VLM detections) — unaffected', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // VLM returns [] for page 2, so only OCR table exists
    const tablesP2 = doc.$('table').onPage(2);
    expect(tablesP2.count()).toBe(1);
    expect(tablesP2.filter('[source=ocr]').count()).toBe(1);
    expect(tablesP2.filter('[source=vlm-bbox]').count()).toBe(0);
  });

  // --------------------------------------------------------------------------
  // VLM crop behavior with overlapping tags
  //
  // When .vlm() is called on overlapping tags, they compute a union bbox.
  // jQuery analog: if you run .offset() on a set of overlapping divs, you'd
  // compute the bounding rect that contains them all.
  // --------------------------------------------------------------------------

  it('.vlm() on overlapping OCR+VLM tables computes union bbox', async () => {
    const calls: Array<{ images: VLMImage[]; prompt: string }> = [];

    // Load OCR + vlmBboxDetect (vlmHandler provides detections during load)
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // Now swap vlm:call to our capture handler for the .vlm() query
    doc.artifacts.set('vlm:call', async (images: VLMImage[], prompt: string) => {
      calls.push({ images, prompt });
      return 'captured';
    });

    // Query all tables on page 1 (both OCR and VLM) and ask VLM about them
    await doc.$('table').onPage(1).vlm('describe all tables');

    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1); // Same page → single image
    const crop = calls[0].images[0].crop!;

    // Union bbox should encompass both:
    //   OCR:  {x:0.05, y:0.40} to {x:0.95, y:0.70}
    //   VLM:  {x:0.03, y:0.38} to {x:0.97, y:0.72}
    // Union: min(0.05,0.03)=0.03 to max(0.95,0.97)=0.97
    expect(crop.xmin).toBeCloseTo(0.03);
    expect(crop.ymin).toBeCloseTo(0.38);
    expect(crop.xmax).toBeCloseTo(0.97);
    expect(crop.ymax).toBeCloseTo(0.72);
  });

  // --------------------------------------------------------------------------
  // Consumer-side reconciliation patterns
  //
  // jQuery: $('table').not('[data-source=vlm-bbox]')   — prefer OCR
  // jQuery: $('table').filter('[data-confidence>0.9]')  — prefer high confidence
  // pdfquery: same patterns via .not() and .filter()
  // --------------------------------------------------------------------------

  it('consumer can prefer OCR via .not() — jQuery $().not() analog', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    const ocrOnly = doc.$('table').not('[source=vlm-bbox]');
    expect(ocrOnly.count()).toBe(2); // Only OCR tables
    expect(ocrOnly.elements.every(e => e.meta.source === 'ocr')).toBe(true);
  });

  it('consumer can prefer VLM via .filter() — jQuery $().filter() analog', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    const vlmOnly = doc.$('table').filter('[source=vlm-bbox]');
    expect(vlmOnly.count()).toBe(1);
    expect(vlmOnly.elements[0].meta.source).toBe('vlm-bbox');
  });

  it('consumer can prefer higher confidence across sources', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    // OCR table: confidence 0.92, VLM table: confidence 0.87
    const highConf = doc.$('table').onPage(1).sortByConfidence();
    expect(highConf.first()!.meta.confidence).toBe(0.92);  // OCR wins
    expect(highConf.last()!.meta.confidence).toBe(0.87);   // VLM
  });

  // --------------------------------------------------------------------------
  // IoU — what unstructured.io uses for overlap detection
  //
  // Not built-in to pdfquery (we layer, not merge), but consumers can
  // compute it from the bbox data that's already there. This test shows
  // the math works on our normalized 0-1 coordinate space.
  // --------------------------------------------------------------------------

  it('overlapping tags have computable IoU from bbox data', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    const tables = doc.$('table').onPage(1);
    expect(tables.count()).toBe(2);

    const [a, b] = tables.elements;
    // Compute IoU manually (what unstructured.io does in vectorized numpy)
    const interXmin = Math.max(a.bbox.xmin, b.bbox.xmin);
    const interYmin = Math.max(a.bbox.ymin, b.bbox.ymin);
    const interXmax = Math.min(a.bbox.xmax, b.bbox.xmax);
    const interYmax = Math.min(a.bbox.ymax, b.bbox.ymax);
    const interW = Math.max(0, interXmax - interXmin);
    const interH = Math.max(0, interYmax - interYmin);
    const interArea = interW * interH;

    const aArea = (a.bbox.xmax - a.bbox.xmin) * (a.bbox.ymax - a.bbox.ymin);
    const bArea = (b.bbox.xmax - b.bbox.xmin) * (b.bbox.ymax - b.bbox.ymin);
    const unionArea = aArea + bArea - interArea;
    const iou = interArea / unionArea;

    // These two tables heavily overlap (same table, slightly different bbox)
    expect(iou).toBeGreaterThan(0.8);

    // unstructured.io's same_region_threshold is 0.5 — these would be merged
    // pdfquery layers them — consumer decides what to do with this IoU value
    expect(iou).toBeGreaterThan(0.5);
  });

  // --------------------------------------------------------------------------
  // vlmBboxDetect plugin mechanics
  // --------------------------------------------------------------------------

  it('vlmBboxDetect skips when no page images', async () => {
    const emitSpy = vi.fn();
    const noImages: PDFQueryPlugin = {
      name: 'google-ocr',
      run() { return { tags: [] }; },
    };
    const fakeVlm: PDFQueryPlugin = {
      name: 'vlm-openrouter',
      run(ctx) {
        ctx.artifacts.set('vlm:call', async () => '[]');
        return {};
      },
    };

    const doc = pdfquery();
    doc.use(noImages);
    doc.use(fakeVlm);
    doc.use(vlmBboxDetect());
    doc.on('vlm-bbox-detect:skip', emitSpy);
    await doc.load();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('vlmBboxDetect skips when no vlm:call handler', async () => {
    const emitSpy = vi.fn();
    const withImages: PDFQueryPlugin = {
      name: 'google-ocr',
      run(ctx) {
        ctx.artifacts.set(ARTIFACT_KEYS.PAGE_IMAGES, pageImages);
        return { tags: [] };
      },
    };

    const doc = pdfquery();
    doc.use(withImages);
    doc.use(vlmBboxDetect());
    doc.on('vlm-bbox-detect:skip', emitSpy);
    await doc.load();

    expect(emitSpy).toHaveBeenCalledTimes(1);
  });

  it('vlmBboxDetect tags carry source=vlm-bbox in attrs', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    const vlmTags = doc.$('[source=vlm-bbox]');
    expect(vlmTags.count()).toBeGreaterThan(0);
    for (const entity of vlmTags.elements) {
      expect(entity.meta.source).toBe('vlm-bbox');
    }
  });

  it('vlmBboxDetect filters by configured types', async () => {
    // Only detect tables, not figures
    const doc = await pdfquery.load([
      ocrSource(),
      vlmHandler(),
      vlmBboxDetect({ types: ['table'] }),
    ]);

    // VLM handler returns both table and figure for page 1,
    // but plugin should filter to only tables
    const vlmFigures = doc.$('figure[source=vlm-bbox]');
    expect(vlmFigures.count()).toBe(0);

    const vlmTables = doc.$('table[source=vlm-bbox]');
    expect(vlmTables.count()).toBe(1);
  });

  it('vlmBboxDetect handles VLM parse errors gracefully', async () => {
    const emitSpy = vi.fn();
    const badVlm: PDFQueryPlugin = {
      name: 'vlm-openrouter',
      run(ctx) {
        ctx.artifacts.set('vlm:call', async () => 'not valid json!!!');
        return {};
      },
    };

    const doc = pdfquery();
    doc.use(ocrSource());
    doc.use(badVlm);
    doc.use(vlmBboxDetect());
    doc.on('vlm-bbox-detect:done', emitSpy);
    await doc.load();

    // Plugin should not crash — just produce 0 VLM tags
    expect(emitSpy).toHaveBeenCalledTimes(1);
    // OCR tags still present
    expect(doc.$('table[source=ocr]').count()).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Counting semantics — jQuery vs reconciled
  //
  // jQuery: document.querySelectorAll('table').length counts ALL tables
  // even if two <table> elements render on top of each other.
  // Same here: $('table').count() is the raw layered count.
  // Consumers who want "unique" tables need IoU-based dedup.
  // --------------------------------------------------------------------------

  it('countByType reflects combined totals from all sources', async () => {
    const doc = await pdfquery.load([ocrSource(), vlmHandler(), vlmBboxDetect()]);

    const stats = doc.$('*').not('page').countByType();
    // 3 tables (2 OCR + 1 VLM), 2 figures (1 OCR + 1 VLM), 1 ocr block
    expect(stats.get('table')).toBe(3);
    expect(stats.get('figure')).toBe(2);
    expect(stats.get('ocr')).toBe(1);
  });
});
