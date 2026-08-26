import { Effect } from 'effect'
import { emitNode, EventHandler, hasHandlers, offNode, onNode, oneNode, PdfEvent, TriggerError } from './events.js'
export type EventMap = Record<string, unknown>
type TriggerArgs<E, K extends keyof E> = unknown extends E[K] ? [detail?: E[K]] : [detail: E[K]]
export interface Collection<T, E extends EventMap = EventMap> extends Iterable<T> {
  readonly length: number; [index: number]: T; [Symbol.iterator](): IterableIterator<T>
  on<K extends keyof E & string>(type: K, handler: (event: PdfEvent<T, E[K]>) => void): Effect.Effect<this>; on<K extends string>(type: K extends keyof E ? never : K, handler: (event: PdfEvent<T, unknown>) => void): Effect.Effect<this>
  off<K extends keyof E & string>(type: K, handler?: (event: PdfEvent<T, E[K]>) => void): Effect.Effect<this>; off<K extends string>(type?: K extends keyof E ? never : K, handler?: (event: PdfEvent<T, unknown>) => void): Effect.Effect<this>
  one<K extends keyof E & string>(type: K, handler: (event: PdfEvent<T, E[K]>) => void): Effect.Effect<this>; one<K extends string>(type: K extends keyof E ? never : K, handler: (event: PdfEvent<T, unknown>) => void): Effect.Effect<this>
  trigger<K extends keyof E & string>(type: K, ...args: TriggerArgs<E, K>): Effect.Effect<void, TriggerError>; trigger<K extends string>(type: K extends keyof E ? never : K, detail?: unknown): Effect.Effect<void, TriggerError>
  each(fn: (node: T, i: number) => void): Effect.Effect<this>; map<U>(fn: (node: T, i: number) => U): U[]; filter(fn: (node: T, i: number) => boolean): Collection<T, E>; first(): Collection<T, E>; last(): Collection<T, E>; eq(i: number): Collection<T, E>
}
const nodesFor = new WeakMap<object, object[]>()
class PdfCollection<T extends object, E extends EventMap = EventMap> {
  readonly length: number; [index: number]: T
  constructor(nodes: T[]) { this.length = nodes.length; nodesFor.set(this, nodes); for (let i = 0; i < nodes.length; i += 1) this[i] = nodes[i] }
  [Symbol.iterator](): IterableIterator<T> { return this.nodes()[Symbol.iterator]() }
  on(type: string, handler: EventHandler<T, unknown>): Effect.Effect<this> {
    return Effect.forEach(this.nodes(), (node) => onNode(node, type, handler as EventHandler<unknown, unknown>), { discard: true }).pipe(Effect.as(this))
  }
  off(type?: string, handler?: EventHandler<T, unknown>): Effect.Effect<this> {
    return Effect.forEach(this.nodes(), (node) => offNode(node, type, handler as EventHandler<unknown, unknown> | undefined), { discard: true }).pipe(Effect.as(this))
  }
  one(type: string, handler: EventHandler<T, unknown>): Effect.Effect<this> {
    return Effect.forEach(this.nodes(), (node) => oneNode(node, type, handler as EventHandler<unknown, unknown>), { discard: true }).pipe(Effect.as(this))
  }
  trigger(type: string, detail?: unknown): Effect.Effect<void, TriggerError> {
    const nodes = unique(this.nodes())
    return Effect.gen(function*() {
      const hasError = nodes.some((node) => hasHandlers(node, 'error'))
      let firstError: unknown
      for (const node of nodes) {
        const errors = yield* emitNode(node, type, detail, hasError)
        if (firstError === undefined && errors.length > 0) firstError = errors[0]
      }
      if (firstError !== undefined) return yield* new TriggerError({ type, cause: firstError })
    })
  }
  each(fn: (node: T, i: number) => void): Effect.Effect<this> { return Effect.sync(() => this.nodes().forEach(fn)).pipe(Effect.as(this)) }
  map<U>(fn: (node: T, i: number) => U): U[] { return this.nodes().map(fn) }
  filter(fn: (node: T, i: number) => boolean): Collection<T, E> { return createCollection<T, E>(this.nodes().filter(fn)) }
  first(): Collection<T, E> { return this.eq(0) } last(): Collection<T, E> { return this.eq(this.length - 1) }
  eq(i: number): Collection<T, E> { const nodes = this.nodes(), index = i < 0 ? nodes.length + i : i; return index >= 0 && index < nodes.length ? createCollection<T, E>([nodes[index]]) : createCollection<T, E>([]) }
  private nodes(): T[] { return nodesFor.get(this) as T[] }
}
function unique<T extends object>(nodes: T[]): T[] { const seen = new Set<T>(), out: T[] = []; for (const node of nodes) if (!seen.has(node)) { seen.add(node); out.push(node) } return out }
export function createCollection<T extends object, E extends EventMap = EventMap>(nodes: T[]): Collection<T, E> { return new PdfCollection<T, E>(nodes) as Collection<T, E> }
export function isCollection(value: unknown): value is Collection<object, EventMap> { return value instanceof PdfCollection }
