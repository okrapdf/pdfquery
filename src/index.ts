import { Collection, createCollection, EventMap, isCollection } from './collection.js'
import { PdfEvent } from './events.js'
type ObjectNode<T> = T extends object ? (T extends Function ? never : Function extends T ? never : T) : never
export default function pdfquery<T extends object, E extends EventMap = EventMap>(wrapper: Collection<T, E>): Collection<T, E>
export default function pdfquery<T extends object, E extends EventMap = EventMap>(nodes: ObjectNode<T>[] | Iterable<ObjectNode<T>>): Collection<T, E>
export default function pdfquery<T extends object, E extends EventMap = EventMap>(node: ObjectNode<T>): Collection<T, E>
export default function pdfquery<T extends object, E extends EventMap = EventMap>(input?: unknown): Collection<T, E> {
  if (input == null) return createCollection<T, E>([]); if (typeof input === 'function') throw new TypeError("pdfquery(fn) is not supported; use pdfquery(doc).on('load', fn)")
  if (isCollection(input)) return input as Collection<T, E>; if (typeof input === 'string') throw new TypeError('pdfquery string selectors are not supported; pass object-shaped nodes')
  const nodes = isIterable(input) ? [...input] : [input]; for (const node of nodes) assertObjectNode(node); return createCollection<T, E>(nodes as T[])
}
function isIterable(value: unknown): value is Iterable<unknown> { return typeof value === 'object' && value !== null && Symbol.iterator in value }
function assertObjectNode(value: unknown): asserts value is object { if (typeof value !== 'object' || value === null) throw new TypeError('pdfquery requires object-shaped nodes; WeakMap cannot key primitive values') }
export type { Collection, PdfEvent }
