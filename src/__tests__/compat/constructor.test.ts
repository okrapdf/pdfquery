// Mirrors https://api.jquery.com/jQuery/ constructor wrapping; divergences inherited from divergence.md: no ready callback, no string selector engine, primitives reject. Effect-TS: the constructor is a smart constructor returning Effect<Collection, PdfQueryInputError>.
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import pdfquery, { PdfQueryInputError } from '../../index.js'
describe('constructor', () => {
  it('wraps a single object-shaped node', () => { const node = { id: 'a' }, $ = Effect.runSync(pdfquery(node)); expect($.length).toBe(1); expect($[0]).toBe(node) })
  it('wraps an array of nodes', () => { const nodes = [{ id: 'a' }, { id: 'b' }], $ = Effect.runSync(pdfquery(nodes)); expect($.length).toBe(2); expect([...$]).toEqual(nodes) })
  it('wraps an iterable of nodes', () => { const nodes = new Set([{ id: 'a' }, { id: 'b' }]), $ = Effect.runSync(pdfquery(nodes)); expect($.length).toBe(2); expect([...$]).toEqual([...nodes]) })
  it('returns an existing pdfquery collection unchanged', () => { const existing = Effect.runSync(pdfquery([{ id: 'a' }])); expect(Effect.runSync(pdfquery(existing))).toBe(existing) })
  it('treats null as an empty collection', () => { expect(Effect.runSync(pdfquery(null as any)).length).toBe(0) })
  it('treats undefined as an empty collection', () => { expect(Effect.runSync(pdfquery(undefined as any)).length).toBe(0) })
  it('wraps an empty array as an empty collection', () => { expect(Effect.runSync(pdfquery<object>([])).length).toBe(0) })
  it('rejects primitive constructor args', () => { const failure = Effect.runSync(pdfquery(42 as any).pipe(Effect.flip)); expect(failure).toBeInstanceOf(PdfQueryInputError); expect(failure.message).toMatch(/pdfquery requires object-shaped nodes; WeakMap cannot key primitive values/) })
  it('rejects primitive values inside arrays', () => { const failure = Effect.runSync(pdfquery([{} as object, 1 as unknown as object]).pipe(Effect.flip)); expect(failure.message).toMatch(/pdfquery requires object-shaped nodes; WeakMap cannot key primitive values/) })
  it('rejects string selector form', () => { const failure = Effect.runSync(pdfquery('.table' as any).pipe(Effect.flip)); expect(failure.message).toMatch(/string selectors are not supported/) })
  it('rejects function-as-constructor-arg at runtime with helpful message', () => { const failure = Effect.runSync(pdfquery((() => {}) as any).pipe(Effect.flip)); expect(failure.message).toMatch(/pdfquery\(fn\) is not supported; use pdfquery\(doc\).on\('load', fn\)/) })
})
