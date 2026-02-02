import { describe, it, expect, vi } from 'vitest';
import pdfquery, { PDFQuerySession } from '../session';
import type { Tag, PageData } from '../tag';
import type { PDFQueryPlugin } from '../plugin';

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

function makeTags(): Tag[] {
  return [
    makeTag('t1', 'table', 1, 'Revenue Table'),
    makeTag('t2', 'figure', 1, 'Chart'),
    makeTag('t3', 'table', 2, 'Expenses Table'),
    makeTag('t4', 'text', 2, 'Some text'),
    makeTag('t5', 'footnote', 3, 'Note 1'),
  ];
}

// ============================================================================
// pdfquery()
// ============================================================================

describe('pdfquery()', () => {
  it('creates an empty session', () => {
    const doc = pdfquery();
    expect(doc).toBeInstanceOf(PDFQuerySession);
  });

  it('$ returns empty QueryResult before data', () => {
    const doc = pdfquery();
    expect(doc.$('table').count()).toBe(0);
    expect(doc.$('*').count()).toBe(0);
    expect(doc.$().count()).toBe(0);
  });

  it('$ returns empty texts/ids arrays before data', () => {
    const doc = pdfquery();
    expect(doc.$('table').texts()).toEqual([]);
    expect(doc.$('*').ids()).toEqual([]);
  });
});

// ============================================================================
// pdfquery.ready()
// ============================================================================

describe('pdfquery.ready()', () => {
  it('creates session with data immediately queryable', () => {
    const doc = pdfquery.ready({ tags: makeTags() });
    expect(doc.$('table').count()).toBe(2);
    expect(doc.$('figure').count()).toBe(1);
    expect(doc.$('footnote').count()).toBe(1);
    // 5 tags + 3 synthetic page entities = 8
    expect(doc.$('*').count()).toBe(8);
  });

  it('queries by page work', () => {
    const doc = pdfquery.ready({ tags: makeTags() });
    // Each page has +1 synthetic page entity
    expect(doc.$('*').onPage(1).count()).toBe(3);
    expect(doc.$('*').onPage(2).count()).toBe(3);
    expect(doc.$('*').onPage(3).count()).toBe(2);
  });

  it('text query works', () => {
    const doc = pdfquery.ready({ tags: makeTags() });
    expect(doc.$('table').contains('Revenue').count()).toBe(1);
  });

  it('accepts pages alongside tags', () => {
    const pages: PageData[] = [
      { pageNumber: 1, width: 612, height: 792 },
      { pageNumber: 2, width: 612, height: 792 },
    ];
    const doc = pdfquery.ready({ tags: makeTags(), pages });
    // 5 tags + 3 synthetic page entities = 8
    expect(doc.$('*').count()).toBe(8);
  });
});

// ============================================================================
// addTags / addPages
// ============================================================================

describe('addTags', () => {
  it('incrementally adds tags', () => {
    const doc = pdfquery();
    doc.addTags([makeTag('t1', 'table', 1, 'First')]);
    expect(doc.$('table').count()).toBe(1);

    doc.addTags([makeTag('t2', 'table', 2, 'Second')]);
    expect(doc.$('table').count()).toBe(2);
  });

  it('recompiles doc on each addTags call', () => {
    const doc = pdfquery();
    doc.addTags([makeTag('t1', 'table', 1)]);
    const countBefore = doc.$('*').count();
    doc.addTags([makeTag('t2', 'figure', 1)]);
    expect(doc.$('*').count()).toBe(countBefore + 1);
  });
});

describe('addPages', () => {
  it('adds page metadata without tags', () => {
    const doc = pdfquery();
    doc.addPages([{ pageNumber: 1, markdown: '# Title' }]);
    // addPages creates the page slot but doesn't synthesize page entities without tags
    // However recompile() creates a synthetic page entity for each page slot
    expect(doc.$('page').count()).toBe(1);
  });
});

// ============================================================================
// Events
// ============================================================================

describe('events', () => {
  it('fires tags event when addTags called', () => {
    const doc = pdfquery();
    const handler = vi.fn();
    doc.on('tags', handler);
    doc.addTags(makeTags());
    expect(handler).toHaveBeenCalledTimes(1);
    expect(typeof handler.mock.calls[0][0]).toBe('function');
  });

  it('fires pages event when addPages called', () => {
    const doc = pdfquery();
    const handler = vi.fn();
    doc.on('pages', handler);
    doc.addPages([{ pageNumber: 1 }]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires custom events via trigger', () => {
    const doc = pdfquery();
    const handler = vi.fn();
    doc.on('ready', handler);
    doc.addTags(makeTags());
    doc.trigger('ready');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('trigger passes data to handler', () => {
    const doc = pdfquery();
    const handler = vi.fn();
    doc.on('custom', handler);
    doc.addTags(makeTags());
    doc.trigger('custom', { foo: 'bar' });
    expect(handler).toHaveBeenCalledWith(expect.any(Function), { foo: 'bar' });
  });

  it('late listener fires immediately if event already fired', () => {
    const doc = pdfquery();
    doc.addTags(makeTags());
    const handler = vi.fn();
    doc.on('tags', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('late listener still receives future events', () => {
    const doc = pdfquery();
    doc.addTags([makeTag('t1', 'table', 1)]);
    const handler = vi.fn();
    doc.on('tags', handler);
    expect(handler).toHaveBeenCalledTimes(1); // late fire
    doc.addTags([makeTag('t2', 'table', 2)]);
    expect(handler).toHaveBeenCalledTimes(2); // new fire
  });

  it('once listener fires only once', () => {
    const doc = pdfquery();
    const handler = vi.fn();
    doc.once('tags', handler);
    doc.addTags([makeTag('t1', 'table', 1)]);
    doc.addTags([makeTag('t2', 'table', 2)]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('$ in event handler reflects current data', () => {
    const doc = pdfquery();
    let countInHandler = 0;
    doc.on('tags', ($) => {
      countInHandler = ($('table') as ReturnType<typeof $>).count();
    });
    doc.addTags([makeTag('t1', 'table', 1), makeTag('t2', 'figure', 1)]);
    expect(countInHandler).toBe(1);
  });
});

// ============================================================================
// Plugins
// ============================================================================

describe('plugins', () => {
  it('runs plugin on addTags', async () => {
    const plugin: PDFQueryPlugin = {
      name: 'test-plugin',
      run: (ctx) => {
        const count = ctx.$('table').count();
        return { data: { tableCount: count } };
      },
    };

    const doc = pdfquery();
    doc.use(plugin);
    doc.addTags(makeTags());

    await new Promise(resolve => setTimeout(resolve, 10));

    const handler = vi.fn();
    doc.on('test-plugin', handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('plugin can produce new tags', async () => {
    const plugin: PDFQueryPlugin = {
      name: 'tag-producer',
      run: () => ({
        tags: [makeTag('plugin-tag', 'heading', 1, 'Plugin Heading')],
      }),
    };

    const doc = pdfquery();
    doc.use(plugin);
    doc.addTags([makeTag('t1', 'table', 1)]);

    await new Promise(resolve => setTimeout(resolve, 10));

    // 1 original tag + 1 plugin tag + 1 synthetic page entity = 3
    expect(doc.$('*').count()).toBe(3);
    expect(doc.$('heading').count()).toBe(1);
  });
});

// ============================================================================
// Chaining
// ============================================================================

describe('chaining', () => {
  it('addTags returns session for chaining', () => {
    const doc = pdfquery();
    expect(doc.addTags(makeTags())).toBe(doc);
  });

  it('addPages returns session for chaining', () => {
    const doc = pdfquery();
    expect(doc.addPages([{ pageNumber: 1 }])).toBe(doc);
  });

  it('on returns session for chaining', () => {
    const doc = pdfquery();
    expect(doc.on('tags', () => {})).toBe(doc);
  });

  it('trigger returns session for chaining', () => {
    const doc = pdfquery();
    expect(doc.trigger('test')).toBe(doc);
  });

  it('use returns session for chaining', () => {
    const doc = pdfquery();
    const plugin: PDFQueryPlugin = { name: 'noop', run: () => ({}) };
    expect(doc.use(plugin)).toBe(doc);
  });

  it('full fluent chain works', () => {
    const handler = vi.fn();
    pdfquery()
      .on('tags', handler)
      .on('ready', handler)
      .addTags(makeTags())
      .trigger('ready');

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Tag attrs pass through to query
// ============================================================================

describe('tag attrs', () => {
  it('confidence attr is queryable', () => {
    const tags: Tag[] = [
      { id: 't1', type: 'table', page: 1, bbox: { x: 0, y: 0, width: 1, height: 0.5 }, attrs: { confidence: 0.95 } },
      { id: 't2', type: 'table', page: 1, bbox: { x: 0, y: 0.5, width: 1, height: 0.5 }, attrs: { confidence: 0.3 } },
    ];
    const doc = pdfquery.ready({ tags });
    // 2 tags + 1 synthetic page entity (confidence=1). So confidence>0.9 matches tag1 + page = 2
    expect(doc.$('[confidence>0.9]').count()).toBe(2);
    expect(doc.$('[confidence<0.5]').count()).toBe(1);
  });
});

// ============================================================================
// .markdown() resolution chain
// ============================================================================

describe('.markdown()', () => {
  it('falls back to entity.text when no handler and no attrs.markdown', async () => {
    const doc = pdfquery.ready({ tags: [makeTag('t1', 'table', 1, 'plain text')] });
    const result = await doc.$('table').eq(0).markdown();
    expect(result).toBe('plain text');
  });

  it('returns empty string when selection is empty', async () => {
    const doc = pdfquery.ready({ tags: makeTags() });
    const result = await doc.$('nonexistent').markdown();
    expect(result).toBe('');
  });

  it('prefers attrs.markdown over entity.text', async () => {
    const tags: Tag[] = [{
      id: 't1', type: 'table', page: 1,
      bbox: { x: 0, y: 0, width: 1, height: 0.5 },
      text: 'plain text',
      attrs: { markdown: '| col1 | col2 |\n|---|---|\n| a | b |' },
    }];
    const doc = pdfquery.ready({ tags });
    const result = await doc.$('table').eq(0).markdown();
    expect(result).toBe('| col1 | col2 |\n|---|---|\n| a | b |');
  });

  it('calls markdown:call handler when registered via plugin', async () => {
    const handler = vi.fn().mockResolvedValue('# Handler Markdown');

    const plugin: PDFQueryPlugin = {
      name: 'md-handler',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', handler);
        return {};
      },
    };

    const session = await pdfquery.load(
      [plugin],
      { tags: [makeTag('t1', 'table', 1, 'fallback')] },
    );

    const result = await session.$('table').eq(0).markdown();
    expect(result).toBe('# Handler Markdown');
    expect(handler).toHaveBeenCalledWith([1], { force: false });
  });

  it('passes force:true to handler', async () => {
    const handler = vi.fn().mockResolvedValue('forced result');

    const plugin: PDFQueryPlugin = {
      name: 'md-handler',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', handler);
        return {};
      },
    };

    const session = await pdfquery.load(
      [plugin],
      { tags: [makeTag('t1', 'table', 1, 'fallback')] },
    );

    await session.$('table').eq(0).markdown({ force: true });
    expect(handler).toHaveBeenCalledWith([1], { force: true });
  });

  it('deduplicates pages when multiple elements on same page', async () => {
    const handler = vi.fn().mockResolvedValue('page 1 md');

    const plugin: PDFQueryPlugin = {
      name: 'md-handler',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', handler);
        return {};
      },
    };

    const session = await pdfquery.load(
      [plugin],
      { tags: [
        makeTag('t1', 'table', 1, 'table A'),
        makeTag('t2', 'figure', 1, 'figure B'),
      ]},
    );

    // Select all non-page entities on page 1 — both map to pageIndex 0 → page 1
    await session.$('*').not('page').onPage(1).markdown();
    expect(handler).toHaveBeenCalledWith([1], { force: false });
  });

  it('collects pages from multi-page selections', async () => {
    const handler = vi.fn().mockResolvedValue('multi-page md');

    const plugin: PDFQueryPlugin = {
      name: 'md-handler',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', handler);
        return {};
      },
    };

    const session = await pdfquery.load(
      [plugin],
      { tags: [
        makeTag('t1', 'table', 1, 'A'),
        makeTag('t2', 'table', 3, 'B'),
      ]},
    );

    await session.$('table').markdown();
    const pages = handler.mock.calls[0][0] as number[];
    expect(pages).toContain(1);
    expect(pages).toContain(3);
    expect(pages).toHaveLength(2);
  });

  it('falls back to attrs.markdown when handler returns null', async () => {
    const handler = vi.fn().mockResolvedValue(null);

    const plugin: PDFQueryPlugin = {
      name: 'md-handler',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', handler);
        return {};
      },
    };

    const tags: Tag[] = [{
      id: 't1', type: 'table', page: 1,
      bbox: { x: 0, y: 0, width: 1, height: 0.5 },
      text: 'text fallback',
      attrs: { markdown: '## attrs markdown' },
    }];

    const session = await pdfquery.load([plugin], { tags });
    const result = await session.$('table').eq(0).markdown();
    expect(handler).toHaveBeenCalled();
    expect(result).toBe('## attrs markdown');
  });

  it('falls back to text when handler returns null and no attrs.markdown', async () => {
    const handler = vi.fn().mockResolvedValue(null);

    const plugin: PDFQueryPlugin = {
      name: 'md-handler',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', handler);
        return {};
      },
    };

    const session = await pdfquery.load(
      [plugin],
      { tags: [makeTag('t1', 'table', 1, 'final fallback')] },
    );

    const result = await session.$('table').eq(0).markdown();
    expect(result).toBe('final fallback');
  });
});

// ============================================================================
// add:tags callback (post-load tag injection)
// ============================================================================

describe('add:tags', () => {
  it('load() registers add:tags callback on artifacts', async () => {
    const session = await pdfquery.load(
      [{ name: 'noop', run: () => ({}) }],
    );
    expect(session.artifacts.has('add:tags')).toBe(true);
    expect(typeof session.artifacts.get('add:tags')).toBe('function');
  });

  it('add:tags callback injects tags and recompiles', async () => {
    const session = await pdfquery.load(
      [{ name: 'noop', run: () => ({}) }],
      { tags: [makeTag('t1', 'table', 1, 'original')] },
    );

    expect(session.$('table').count()).toBe(1);

    // Simulate a handler injecting tags post-load
    const addTags = session.artifacts.get('add:tags') as (tags: Tag[]) => void;
    addTags([makeTag('t2', 'figure', 2, 'injected')]);

    expect(session.$('figure').count()).toBe(1);
    expect(session.$('*').count()).toBe(4); // 2 tags + 2 synthetic page entities
  });

  it('handler can inject tags via add:tags during markdown() call', async () => {
    const injectedTags: Tag[] = [
      makeTag('llama-1', 'ocr', 1, 'extracted word 1'),
      makeTag('llama-2', 'ocr', 1, 'extracted word 2'),
    ];

    const markdownHandler = vi.fn().mockImplementation(async (pages: number[], _opts: unknown) => {
      // Simulate what LlamaParse defer handler does:
      // 1. Upload+parse (mocked)
      // 2. Inject tags via add:tags
      const addTags = session.artifacts.get('add:tags') as (tags: Tag[]) => void;
      addTags(injectedTags);
      return `# Page ${pages[0]} markdown`;
    });

    const plugin: PDFQueryPlugin = {
      name: 'deferred-llamaparse',
      run: (ctx) => {
        ctx.artifacts.set('markdown:call', markdownHandler);
        return {};
      },
    };

    const session = await pdfquery.load(
      [plugin],
      { tags: [makeTag('t1', 'table', 1, 'original table')] },
    );

    // Before .markdown() call — no OCR tags
    expect(session.$('ocr').count()).toBe(0);

    // .markdown() triggers handler which injects tags
    const md = await session.$('table').eq(0).markdown();
    expect(md).toBe('# Page 1 markdown');

    // After .markdown() — OCR tags are now in the session
    expect(session.$('ocr').count()).toBe(2);
    expect(session.$('ocr').texts()).toContain('extracted word 1');
    expect(session.$('ocr').texts()).toContain('extracted word 2');
  });
});
