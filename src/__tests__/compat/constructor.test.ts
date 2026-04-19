// Mirrors https://api.jquery.com/jQuery/ constructor wrapping; divergences inherited from divergence.md: no ready callback, no string selector engine, primitives reject.
import { describe, expect, it } from 'vitest'
import pdfquery from '../../index.js'
describe('constructor', () => {
  it('wraps a single object-shaped node', () => { const node = { id: 'a' }, $ = pdfquery(node); expect($.length).toBe(1); expect($[0]).toBe(node) })
  it('wraps an array of nodes', () => { const nodes = [{ id: 'a' }, { id: 'b' }], $ = pdfquery(nodes); expect($.length).toBe(2); expect([...$]).toEqual(nodes) })
  it('wraps an iterable of nodes', () => { const nodes = new Set([{ id: 'a' }, { id: 'b' }]), $ = pdfquery(nodes); expect($.length).toBe(2); expect([...$]).toEqual([...nodes]) })
  it('returns an existing pdfquery collection unchanged', () => { const existing = pdfquery([{ id: 'a' }]); expect(pdfquery(existing)).toBe(existing) })
  it('treats null as an empty collection', () => { expect(pdfquery(null as any).length).toBe(0) })
  it('treats undefined as an empty collection', () => { expect(pdfquery(undefined as any).length).toBe(0) })
  it('wraps an empty array as an empty collection', () => { expect(pdfquery<object>([]).length).toBe(0) })
  it('rejects primitive constructor args', () => { expect(() => pdfquery(42 as any)).toThrow(/pdfquery requires object-shaped nodes; WeakMap cannot key primitive values/) })
  it('rejects primitive values inside arrays', () => { expect(() => pdfquery([{} as object, 1 as unknown as object])).toThrow(/pdfquery requires object-shaped nodes; WeakMap cannot key primitive values/) })
  it('rejects string selector form', () => { expect(() => pdfquery('.table' as any)).toThrow(/string selectors are not supported/) })
  it('rejects function-as-constructor-arg at runtime with helpful message', () => { expect(() => pdfquery((() => {}) as any)).toThrow(/pdfquery\(fn\) is not supported; use pdfquery\(doc\).on\('load', fn\)/) })
})
