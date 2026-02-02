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
