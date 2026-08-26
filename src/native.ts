import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Effect, Ref, Schema } from 'effect'

export class NativeEngineError extends Schema.TaggedError<NativeEngineError>()('NativeEngineError', {
  message: Schema.String,
  cause: Schema.Defect()
}) {}

export class NativeQueryError extends Schema.TaggedError<NativeQueryError>()('NativeQueryError', {
  message: Schema.String,
  cause: Schema.Defect()
}) {}

export type NativeDiagnostic = Readonly<Record<string, unknown>>

export type NativeQueryNode = Readonly<Record<string, unknown>> & {
  readonly text: string
  toJSON(): Readonly<Record<string, unknown>>
}

interface NativeQueryResult {
  readonly resultIds: readonly string[]
  readonly diagnostics: readonly NativeDiagnostic[]
  readonly handles?: readonly NativeHandleDefinition[]
}

interface NativeHandleDefinition {
  readonly snapshot: Readonly<Record<string, unknown>> & {
    readonly id: string
    readonly text: string
  }
  readonly type: string
  readonly rawRole?: string
  readonly parentId: string | null
  readonly childIds: readonly string[]
  readonly title?: string
  readonly expandedText?: string
  readonly ownText?: string
  readonly pageNumber?: number
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly rawAttributes?: Readonly<Record<string, unknown>>
}

interface NativeDocumentHandle {
  queryJson(selector: string, includeHandles: boolean): string
}

interface NativeModule {
  NativeDocument: new (bytes: Uint8Array) => NativeDocumentHandle
  version(): string
}

export interface TaggedPdfDocument {
  readonly diagnostics: Effect.Effect<readonly NativeDiagnostic[]>
  query(selector: string): Effect.Effect<NativeQueryNode[], NativeQueryError>
}

const require = createRequire(import.meta.url)
let nativeModule: NativeModule | undefined

const loadNativeModule = (): Effect.Effect<NativeModule, NativeEngineError> =>
  Effect.try({
    try: () => {
      if (nativeModule) return nativeModule
      const candidates = [
        new URL('./native/pdfquery_native.cjs', import.meta.url),
        new URL('../dist/native/pdfquery_native.cjs', import.meta.url)
      ]
      const binding = candidates.find((candidate) => existsSync(fileURLToPath(candidate)))
      if (!binding) throw new Error('Rust PDF engine is missing; reinstall pdfquery')
      nativeModule = require(fileURLToPath(binding)) as NativeModule
      return nativeModule
    },
    catch: (cause) => new NativeEngineError({ message: errorMessage(cause), cause })
  })

export const openTaggedPdf = Effect.fn('openTaggedPdf')(function*(
  input: Uint8Array | ArrayBuffer
): Effect.fn.Return<TaggedPdfDocument, NativeEngineError> {
  const bytes = input instanceof Uint8Array
    ? new Uint8Array(input)
    : new Uint8Array(input.slice(0))
  const module = yield* loadNativeModule()
  const nativeDocument = yield* Effect.try({
    try: () => new module.NativeDocument(bytes),
    catch: (cause) => new NativeEngineError({ message: errorMessage(cause), cause })
  })
  const diagnosticsRef = yield* Ref.make<readonly NativeDiagnostic[]>([])
  let handlesById: ReadonlyMap<string, NativeQueryNode> | undefined

  return {
    diagnostics: Ref.get(diagnosticsRef),
    query: (selector: string) => Effect.gen(function*() {
      const includeHandles = handlesById === undefined
      const result = yield* Effect.try({
        try: () => JSON.parse(
          nativeDocument.queryJson(selector, includeHandles)
        ) as NativeQueryResult,
        catch: (cause) => new NativeQueryError({ message: errorMessage(cause), cause })
      })
      yield* Ref.set(diagnosticsRef, result.diagnostics)
      if (includeHandles) {
        if (!result.handles) {
          return yield* new NativeQueryError({ message: 'Rust PDF engine omitted the initial handle table', cause: undefined })
        }
        handlesById = hydrateHandles(result.handles)
      }
      const nodes: NativeQueryNode[] = []
      for (const id of result.resultIds) {
        const handle = handlesById!.get(id)
        if (!handle) return yield* new NativeQueryError({ message: `Rust PDF engine returned an unknown node ID: ${id}`, cause: undefined })
        nodes.push(handle)
      }
      return nodes
    })
  }
})

function hydrateHandles(definitions: readonly NativeHandleDefinition[]): ReadonlyMap<string, NativeQueryNode> {
  const handles = new Map<string, NativeQueryNode>()

  for (const definition of definitions) {
    const handle = createHandle(definition.snapshot)
    defineProperty(handle, 'type', definition.type)
    defineOptionalProperty(handle, 'rawRole', definition.rawRole)
    defineOptionalProperty(handle, 'title', definition.title)
    defineOptionalProperty(handle, 'expandedText', definition.expandedText)
    defineOptionalProperty(handle, 'ownText', definition.ownText)
    defineOptionalProperty(handle, 'pageNumber', definition.pageNumber)
    defineOptionalProperty(handle, 'attributes', definition.attributes)
    defineOptionalProperty(handle, 'rawAttributes', definition.rawAttributes)
    if (definition.type === 'page') {
      defineProperty(handle, 'mcids', [])
      defineProperty(handle, 'content', [])
      defineProperty(handle, 'bboxes', [])
      defineProperty(handle, 'bbox', null)
    }
    handles.set(definition.snapshot.id, handle)
  }

  for (const definition of definitions) {
    const handle = handles.get(definition.snapshot.id)
    if (!handle) continue
    defineProperty(
      handle,
      'parent',
      definition.parentId === null ? null : (handles.get(definition.parentId) ?? null)
    )
    defineProperty(
      handle,
      'children',
      definition.childIds.flatMap((id) => {
        const child = handles.get(id)
        return child ? [child] : []
      })
    )
  }

  return handles
}

function createHandle(
  snapshot: Readonly<Record<string, unknown>> & { readonly text: string }
): NativeQueryNode {
  const handle = Object.fromEntries(Object.entries(snapshot)) as Record<string, unknown>
  Object.defineProperty(handle, 'toJSON', {
    configurable: false,
    enumerable: false,
    value: () => snapshot,
    writable: false
  })
  return handle as NativeQueryNode
}

function defineOptionalProperty(
  handle: NativeQueryNode,
  key: string,
  value: unknown
): void {
  if (value !== undefined) defineProperty(handle, key, value)
}

function defineProperty(handle: NativeQueryNode, key: string, value: unknown): void {
  Object.defineProperty(handle, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
