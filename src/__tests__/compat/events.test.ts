// Mirrors https://api.jquery.com/category/events/ on/off/one/trigger; divergences inherited from divergence.md: no bubbling, capture, delegation, DOM bridge, or bound this. Effect-TS: registration and trigger return Effects; unhandled handler failures surface as TriggerError.
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import pdfquery, { PdfEvent, TriggerError } from '../../index.js'
describe('events', () => {
  it('on and trigger deliver PdfEvent to every node', async () => {
    const nodes = [{ id: 'a' }, { id: 'b' }], seen: PdfEvent<{ id: string }, { score: number }>[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery<{ id: string }, { verify: { score: number } }>(nodes)
      yield* $.on('verify', (event) => seen.push(event))
      yield* $.trigger('verify', { score: 1 })
    }))
    expect(seen).toEqual([{ type: 'verify', target: nodes[0], detail: { score: 1 } }, { type: 'verify', target: nodes[1], detail: { score: 1 } }])
  })
  it('invokes handlers in insertion order', async () => {
    const order: number[] = []
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.on('change', () => order.push(1))
      yield* $.on('change', () => order.push(2))
      yield* $.trigger('change')
    }))
    expect(order).toEqual([1, 2])
  })
  it('deduplicates repeated type and handler registrations', async () => {
    const handler = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.on('change', handler)
      yield* $.on('change', handler)
      yield* $.trigger('change')
    }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('one removes itself after the first trigger', async () => {
    const handler = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.one('load', handler)
      yield* $.trigger('load')
      yield* $.trigger('load')
    }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
  it('off(type, handler) removes one specific handler', async () => {
    const keep = vi.fn(), remove = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.on('change', keep)
      yield* $.on('change', remove)
      yield* $.off('change', remove)
      yield* $.trigger('change')
    }))
    expect(keep).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })
  it('off(type, handler) removes one-shot handlers by original handler', async () => {
    const handler = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.one('change', handler)
      yield* $.off('change', handler)
      yield* $.trigger('change')
    }))
    expect(handler).not.toHaveBeenCalled()
  })
  it('off(type) removes all handlers for that type only', async () => {
    const change = vi.fn(), verify = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.on('change', change)
      yield* $.on('verify', verify)
      yield* $.off('change')
      yield* $.trigger('change')
      yield* $.trigger('verify')
    }))
    expect(change).not.toHaveBeenCalled()
    expect(verify).toHaveBeenCalledTimes(1)
  })
  it('off() removes every handler from the collection nodes', async () => {
    const change = vi.fn(), verify = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.on('change', change)
      yield* $.on('verify', verify)
      yield* $.off()
      yield* $.trigger('change')
      yield* $.trigger('verify')
    }))
    expect(change).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
  })
  it('continues handlers and fails with TriggerError when no error listener exists', async () => {
    const error = new Error('boom'), after = vi.fn()
    const failure = await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery({ id: 'a' })
      yield* $.on('change', () => { throw error })
      yield* $.on('change', after)
      yield* $.trigger('change')
    }).pipe(Effect.flip))
    expect(failure).toBeInstanceOf(TriggerError)
    const triggerError = failure as TriggerError
    expect(triggerError.type).toBe('change')
    expect(triggerError.cause).toBe(error)
    expect(after).toHaveBeenCalledTimes(1)
  })
  it('swallows handler errors and emits error detail when an error listener exists', async () => {
    const node = { id: 'a' }, error = new Error('boom'), emitted: unknown[] = [], after = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery(node)
      yield* $.on('error', (event) => emitted.push(event.detail))
      yield* $.on('change', () => { throw error })
      yield* $.on('change', after)
      yield* $.trigger('change')
    }))
    expect(after).toHaveBeenCalledTimes(1)
    expect(emitted).toEqual([{ source: 'handler', type: 'change', error }])
  })
  it('deduplicates repeated nodes during trigger', async () => {
    const node = { id: 'a' }, handler = vi.fn()
    await Effect.runPromise(Effect.gen(function*() {
      const $ = yield* pdfquery([node, node])
      yield* $.on('change', handler)
      yield* $.trigger('change')
    }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
