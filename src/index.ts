import { Effect, Predicate, Schema } from 'effect'
import { Collection, createCollection, EventMap, isCollection } from './collection.js'
import { PdfEvent, TriggerError } from './events.js'
export class PdfQueryInputError extends Schema.TaggedError<PdfQueryInputError>()('PdfQueryInputError', {
  message: Schema.String
}) {}
type ObjectNode<T> = T extends object ? (T extends Function ? never : Function extends T ? never : T) : never
export default function pdfquery<T extends object, E extends EventMap = EventMap>(wrapper: Collection<T, E>): Effect.Effect<Collection<T, E>, PdfQueryInputError>
export default function pdfquery<T extends object, E extends EventMap = EventMap>(nodes: ObjectNode<T>[] | Iterable<ObjectNode<T>>): Effect.Effect<Collection<T, E>, PdfQueryInputError>
export default function pdfquery<T extends object, E extends EventMap = EventMap>(node: ObjectNode<T>): Effect.Effect<Collection<T, E>, PdfQueryInputError>
export default function pdfquery<T extends object, E extends EventMap = EventMap>(input?: unknown): Effect.Effect<Collection<T, E>, PdfQueryInputError> {
  return Effect.gen(function*() {
    if (input == null) return createCollection<T, E>([])
    if (Predicate.isFunction(input)) return yield* new PdfQueryInputError({ message: "pdfquery(fn) is not supported; use pdfquery(doc).on('load', fn)" })
    if (isCollection(input)) return input as Collection<T, E>
    if (Predicate.isString(input)) return yield* new PdfQueryInputError({ message: 'pdfquery string selectors are not supported; pass object-shaped nodes' })
    const nodes = isIterable(input) ? [...input] : [input]
    for (const node of nodes) {
      if (!isObjectNode(node)) return yield* new PdfQueryInputError({ message: 'pdfquery requires object-shaped nodes; WeakMap cannot key primitive values' })
    }
    return createCollection<T, E>(nodes as T[])
  })
}
function isIterable(value: unknown): value is Iterable<unknown> { return typeof value === 'object' && value !== null && Symbol.iterator in value }
function isObjectNode(value: unknown): value is object { return typeof value === 'object' && value !== null }
export type { Collection, PdfEvent }
export { TriggerError }
