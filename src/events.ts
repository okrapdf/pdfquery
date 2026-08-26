import { Effect, Schema } from 'effect'
export interface PdfEvent<T, D = unknown> { readonly type: string; readonly target: T; readonly detail: D }
export type EventHandler<T, D = unknown> = (event: PdfEvent<T, D>) => void
export class TriggerError extends Schema.TaggedError<TriggerError>()('TriggerError', {
  type: Schema.String,
  cause: Schema.Defect()
}) {}
const originalHandler = Symbol('pdfquery.original'), handlers = new WeakMap<object, Map<string, Set<StoredHandler>>>()
type StoredHandler = EventHandler<unknown, unknown> & { [originalHandler]?: EventHandler<unknown, unknown> }
function same(a: StoredHandler, b: StoredHandler): boolean { const ao = a[originalHandler], bo = b[originalHandler]; return a === b || ao === b || bo === a || (ao !== undefined && ao === bo) }
function setFor(node: object, type: string, create: boolean): Set<StoredHandler> | undefined {
  let byType = handlers.get(node); if (!byType && create) handlers.set(node, byType = new Map()); if (!byType) return undefined
  let set = byType.get(type); if (!set && create) byType.set(type, set = new Set()); return set
}
function addHandler(node: object, type: string, handler: EventHandler<unknown, unknown>): void { const set = setFor(node, type, true)!, stored = handler as StoredHandler; for (const existing of set) if (same(existing, stored)) return; set.add(stored) }
function addOnce(node: object, type: string, handler: EventHandler<unknown, unknown>): void {
  const once = ((event: PdfEvent<unknown, unknown>) => { removeHandlers(node, type, once); handler(event) }) as StoredHandler; once[originalHandler] = handler; addHandler(node, type, once)
}
function removeHandlers(node: object, type?: string, handler?: EventHandler<unknown, unknown>): void {
  const byType = handlers.get(node); if (!byType) return; if (type === undefined) { handlers.delete(node); return }
  const set = byType.get(type); if (!set) return; if (handler === undefined) byType.delete(type)
  else { const stored = handler as StoredHandler; for (const existing of [...set]) if (same(existing, stored)) set.delete(existing); if (set.size === 0) byType.delete(type) }
  if (byType.size === 0) handlers.delete(node)
}
export const onNode = (node: object, type: string, handler: EventHandler<unknown, unknown>): Effect.Effect<void> => Effect.sync(() => addHandler(node, type, handler))
export const oneNode = (node: object, type: string, handler: EventHandler<unknown, unknown>): Effect.Effect<void> => Effect.sync(() => addOnce(node, type, handler))
export const offNode = (node: object, type?: string, handler?: EventHandler<unknown, unknown>): Effect.Effect<void> => Effect.sync(() => removeHandlers(node, type, handler))
export function hasHandlers(node: object, type: string): boolean { return (setFor(node, type, false)?.size ?? 0) > 0 }
export const emitNode = <T extends object>(node: T, type: string, detail: unknown, hasErrorListener: boolean): Effect.Effect<unknown[]> => Effect.sync(() => {
  const set = setFor(node, type, false), errors: unknown[] = []; if (!set) return errors
  for (const handler of [...set]) try { handler({ type, target: node, detail }) } catch (error) { if (type === 'error') errors.push(error); else if (hasErrorListener) errors.push(...emitError(node, { source: 'handler', type, error })); else errors.push(error) }
  return errors
})
function emitError(node: object, detail: unknown): unknown[] { const set = setFor(node, 'error', false), errors: unknown[] = []; if (!set) return errors; for (const handler of [...set]) try { handler({ type: 'error', target: node, detail }) } catch (error) { errors.push(error) }; return errors }
