import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
  readonly diagnostics: readonly NativeDiagnostic[]
  query(selector: string): NativeQueryNode[]
}

const require = createRequire(import.meta.url)
let nativeModule: NativeModule | undefined

function loadNativeModule(): NativeModule {
  const candidates = [
    new URL('./native/pdfquery_native.cjs', import.meta.url),
    new URL('../dist/native/pdfquery_native.cjs', import.meta.url)
  ]
  const binding = candidates.find((candidate) => existsSync(fileURLToPath(candidate)))
  if (!binding) throw new Error('Rust PDF engine is missing; reinstall pdfquery')
  nativeModule ??= require(fileURLToPath(binding)) as NativeModule
  return nativeModule
}

export async function openTaggedPdf(input: Uint8Array | ArrayBuffer): Promise<TaggedPdfDocument> {
  const bytes = input instanceof Uint8Array
    ? new Uint8Array(input)
    : new Uint8Array(input.slice(0))
  const nativeDocument = new (loadNativeModule().NativeDocument)(bytes)
  let diagnostics: readonly NativeDiagnostic[] = []
  let handlesById: ReadonlyMap<string, NativeQueryNode> | undefined

  return {
    get diagnostics() {
      return diagnostics
    },
    query(selector: string) {
      const includeHandles = handlesById === undefined
      const result = JSON.parse(
        nativeDocument.queryJson(selector, includeHandles)
      ) as NativeQueryResult
      diagnostics = result.diagnostics
      if (includeHandles) {
        if (!result.handles) {
          throw new Error('Rust PDF engine omitted the initial handle table')
        }
        handlesById = hydrateHandles(result.handles)
      }
      return result.resultIds.map((id) => {
        const handle = handlesById!.get(id)
        if (!handle) throw new Error(`Rust PDF engine returned an unknown node ID: ${id}`)
        return handle
      })
    }
  }
}

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
