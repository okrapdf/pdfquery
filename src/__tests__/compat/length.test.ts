// Mirrors https://api.jquery.com/length/ indexed collection shape; divergences inherited from divergence.md: collection contains caller-provided object nodes only.
import { describe, expect, it } from 'vitest'
import pdfquery from '../../index.js'
describe('length and indexes', () => {
  it('exposes length and indexed access', () => { const nodes = [{ id: 'a' }, { id: 'b' }], $ = pdfquery(nodes); expect($.length).toBe(2); expect($[0]).toBe(nodes[0]); expect($[1]).toBe(nodes[1]) })
  it('updates length after filter', () => { const filtered = pdfquery([{ keep: true }, { keep: false }]).filter((node) => node.keep); expect(filtered.length).toBe(1); expect(filtered[0]).toEqual({ keep: true }) })
  it('updates length after first', () => { expect(pdfquery([{ id: 'a' }, { id: 'b' }]).first().length).toBe(1) })
  it('updates length after last', () => { expect(pdfquery([{ id: 'a' }, { id: 'b' }]).last().length).toBe(1) })
  it('updates length after eq hit and miss', () => { const $ = pdfquery([{ id: 'a' }, { id: 'b' }]); expect($.eq(0).length).toBe(1); expect($.eq(10).length).toBe(0) })
})
