import { describe, it, expect } from 'vitest';
import { loadFixture } from '../fixtures';

describe('QueryEngine selectors', () => {
  const session = loadFixture('financial-report');
  const $$ = session.$;

  it('selects all with *', () => {
    expect($$('*').count()).toBeGreaterThan(0);
  });

  it('selects by bare tag name', () => {
    expect($$('table').count()).toBe(8);
  });

  it('selects by dot-prefixed type', () => {
    expect($$('.table').count()).toBe(8);
  });

  it('selects by attribute', () => {
    expect($$('[confidence>0.9]').count()).toBeGreaterThan(0);
  });

  it('combines tag and attribute', () => {
    expect($$('table[confidence>0.9]').count()).toBeGreaterThan(0);
  });
});

describe('QueryResult methods', () => {
  const session = loadFixture('financial-report');
  const $$ = session.$;

  it('texts() returns array of strings', () => {
    const texts = $$('table').texts();
    expect(Array.isArray(texts)).toBe(true);
    expect(texts.length).toBe(8);
    expect(typeof texts[0]).toBe('string');
  });

  it('count() returns number', () => {
    expect(typeof $$('table').count()).toBe('number');
  });

  it('first() returns single entity or undefined', () => {
    const first = $$('table').first();
    expect(first).toBeDefined();
    expect(first?.type).toBe('table');
  });

  it('filter() chains correctly', () => {
    const highConf = $$('table').filter('[confidence>0.95]');
    expect(highConf.count()).toBeLessThanOrEqual($$('table').count());
  });

  it('onPage() filters by page', () => {
    const page1 = $$('*').onPage(1);
    expect(page1.count()).toBeGreaterThan(0);
    page1.toArray().forEach(e => expect(e.pageIndex).toBe(0));
  });

  it('countByType() returns Map', () => {
    const counts = $$('*').countByType();
    expect(counts instanceof Map).toBe(true);
    expect(counts.get('table')).toBe(8);
  });

  it('map() transforms entities', () => {
    const ids = $$('table').map(e => e.id);
    expect(ids.length).toBe(8);
    expect(typeof ids[0]).toBe('string');
  });
});

describe('Invoice fixture', () => {
  const session = loadFixture('invoice');
  const $$ = session.$;

  it('loads invoice fixture', () => {
    expect($$('*').count()).toBeGreaterThan(0);
  });

  it('finds currency entities', () => {
    const currencies = $$('currency');
    expect(currencies.count()).toBeGreaterThan(0);
  });

  it('finds field entities', () => {
    const fields = $$('[type=date]');
    expect(fields.count()).toBeGreaterThanOrEqual(0);
  });
});
