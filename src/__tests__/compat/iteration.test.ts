// Mirrors https://api.jquery.com/category/traversing/ each/map/filter/first/last/eq iteration helpers; divergences inherited from divergence.md: no traversal tree ownership, map returns array, each cannot break. Effect-TS: each returns an Effect; map/filter/first/last/eq stay synchronous.
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import pdfquery from '../../index.js'
describe('iteration', () => {
  it('each visits every node with index and returns the collection', () => { const nodes = [{ id: 'a' }, { id: 'b' }], seen: string[] = [], $ = Effect.runSync(pdfquery(nodes)), returned = Effect.runSync($.each((node, i) => seen.push(`${i}:${node.id}`))); expect(returned).toBe($); expect(seen).toEqual(['0:a', '1:b']) })
  it('each ignores return false and continues', () => { const seen: string[] = [], $ = Effect.runSync(pdfquery([{ id: 'a' }, { id: 'b' }])); Effect.runSync($.each((node) => { seen.push(node.id); return false as unknown as void })); expect(seen).toEqual(['a', 'b']) })
  it('map returns a native array', () => { const ids = Effect.runSync(pdfquery([{ id: 'a' }, { id: 'b' }])).map((node, i) => `${i}:${node.id}`); expect(Array.isArray(ids)).toBe(true); expect(ids).toEqual(['0:a', '1:b']) })
  it('filter returns a collection of matching nodes', () => { const nodes = [{ id: 'a', keep: true }, { id: 'b', keep: false }], filtered = Effect.runSync(pdfquery(nodes)).filter((node) => node.keep); expect(filtered.length).toBe(1); expect(filtered[0]).toBe(nodes[0]) })
  it('first returns the first node as a collection', () => { const nodes = [{ id: 'a' }, { id: 'b' }], first = Effect.runSync(pdfquery(nodes)).first(); expect(first.length).toBe(1); expect(first[0]).toBe(nodes[0]) })
  it('last returns the last node as a collection', () => { const nodes = [{ id: 'a' }, { id: 'b' }], last = Effect.runSync(pdfquery(nodes)).last(); expect(last.length).toBe(1); expect(last[0]).toBe(nodes[1]) })
  it('eq returns the node at index as a collection', () => { const nodes = [{ id: 'a' }, { id: 'b' }], second = Effect.runSync(pdfquery(nodes)).eq(1); expect(second.length).toBe(1); expect(second[0]).toBe(nodes[1]) })
  it('eq supports negative indexes from the end', () => { const nodes = [{ id: 'a' }, { id: 'b' }], last = Effect.runSync(pdfquery(nodes)).eq(-1); expect(last.length).toBe(1); expect(last[0]).toBe(nodes[1]) })
  it('eq out of bounds returns an empty collection', () => { expect(Effect.runSync(pdfquery([{ id: 'a' }])).eq(5).length).toBe(0); expect(Effect.runSync(pdfquery([{ id: 'a' }])).eq(-5).length).toBe(0) })
  it('supports Symbol.iterator', () => { const seen: string[] = []; for (const node of Effect.runSync(pdfquery([{ id: 'a' }, { id: 'b' }]))) seen.push(node.id); expect(seen).toEqual(['a', 'b']) })
  it('supports spread and Array.from', () => { const nodes = [{ id: 'a' }, { id: 'b' }], $ = Effect.runSync(pdfquery(nodes)); expect([...$]).toEqual(nodes); expect(Array.from($)).toEqual(nodes) })
})
