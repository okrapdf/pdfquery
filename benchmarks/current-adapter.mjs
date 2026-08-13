import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

export function createCurrentAdapter(root = defaultRoot) {
  const require = createRequire(import.meta.url)
  const native = require(resolve(root, 'dist', 'native', 'pdfquery_native.cjs'))

  return {
    async open(input) {
      const bytes = input instanceof Uint8Array
        ? new Uint8Array(input)
        : new Uint8Array(input.slice(0))
      const nativeDocument = new native.NativeDocument(bytes)
      let handlesById

      return {
        query(selector) {
          const includeHandles = handlesById === undefined
          const result = JSON.parse(nativeDocument.queryJson(selector, includeHandles))
          if (includeHandles) {
            if (!result.handles) throw new Error('candidate omitted initial handles')
            handlesById = hydrateHandles(result.handles)
          }
          return result.resultIds.map((id) => {
            const handle = handlesById.get(id)
            if (!handle) throw new Error(`candidate returned unknown node ID ${id}`)
            return handle
          })
        },
        free() { nativeDocument.free() }
      }
    },
    protocolBytes(input, selector) {
      const bytes = input instanceof Uint8Array
        ? new Uint8Array(input)
        : new Uint8Array(input.slice(0))
      const nativeDocument = new native.NativeDocument(bytes)
      try {
        const first = nativeDocument.queryJson(selector, true)
        const repeated = nativeDocument.queryJson(selector, false)
        return {
          first: Buffer.byteLength(first),
          repeated: Buffer.byteLength(repeated)
        }
      } finally {
        nativeDocument.free()
      }
    }
  }
}

function hydrateHandles(definitions) {
  const handles = new Map()

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

function createHandle(snapshot) {
  const handle = Object.fromEntries(Object.entries(snapshot))
  Object.defineProperty(handle, 'toJSON', {
    configurable: false,
    enumerable: false,
    value: () => snapshot,
    writable: false
  })
  return handle
}

function defineOptionalProperty(handle, key, value) {
  if (value !== undefined) defineProperty(handle, key, value)
}

function defineProperty(handle, key, value) {
  Object.defineProperty(handle, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
}
