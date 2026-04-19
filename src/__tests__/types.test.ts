// Mirrors https://api.jquery.com/Types/ wrapper typing; divergences inherited from divergence.md: no ready callback, no selector overload, map returns array.
import { expectTypeOf, describe, it } from 'vitest'
import pdfquery, { Collection, PdfEvent } from '../index.js'
describe('types', () => {
  it('generic T infers', () => { const htmlNodes: HTMLElement[] = [], $html = pdfquery(htmlNodes); expectTypeOf($html).toEqualTypeOf<Collection<HTMLElement>>() })
  it('event-map strong typing', () => { type PdfEvents = { verify: { score: number; reasons: string[] }; annotation: { x: number; y: number; text: string }; load: void }; const nodes = [{ id: 'a' }], $ = pdfquery<{ id: string }, PdfEvents>(nodes); $.on('verify', (e) => { expectTypeOf(e.detail).toEqualTypeOf<{ score: number; reasons: string[] }>(); expectTypeOf(e.target).toEqualTypeOf<{ id: string }>() }); $.on('anything', (e) => expectTypeOf(e.detail).toEqualTypeOf<unknown>()); $.trigger('verify', { score: 0.9, reasons: [] })
    // @ts-expect-error — wrong shape
    $.trigger('verify', { score: 'bad' })
    // @ts-expect-error — missing required
    $.trigger('verify', {}) })
  it('map returns array', () => { const ids = pdfquery([{ id: 'a' }]).map(n => n.id); expectTypeOf(ids).toEqualTypeOf<string[]>() })
  it('filter preserves T and E', () => { type PdfEvents = { verify: { score: number } }; const filtered = pdfquery<{ id: string }, PdfEvents>([{ id: 'a' }]).filter(n => !!n.id); expectTypeOf(filtered).toEqualTypeOf<Collection<{ id: string }, PdfEvents>>() })
  it('event object exports', () => { expectTypeOf<PdfEvent<{ id: string }, { score: number }>>().toEqualTypeOf<{ readonly type: string; readonly target: { id: string }; readonly detail: { score: number } }>() })
  it('NO fn ready-callback — pdfquery(fn) is @ts-expect-error', () => { if (false) {
    // @ts-expect-error — pdfquery(fn) is not supported
    pdfquery(() => {})
  } })
})
