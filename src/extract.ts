import {
  queryStructureNodes,
  type PdfStructureDocument,
  type PdfStructureNode,
  type PdfStructurePage
} from '@okrapdf/pdfdom/native'

type QueryNode = PdfStructureNode | PdfStructurePage

/**
 * Declarative extraction-map grammar (Cheerio `$.extract`-style, CLI-safe):
 * - `"selector"`: first match, projected as text.
 * - `["selector"]`: every match, projected as text.
 * - `{ "selector": S, "value": "field" }`: named serialized field projection.
 * - `{ "selector": S, "value": { ...map } }`: nested map evaluated relative to
 *   the selected node's descendants.
 * Callback values are intentionally excluded from the CLI grammar.
 */
export type ExtractionDescriptor =
  | string
  | readonly [ExtractionDescriptor]
  | {
    readonly selector: string
    readonly value?: string | ExtractionMap
  }

export interface ExtractionMap {
  readonly [key: string]: ExtractionDescriptor
}

export class ExtractionMapError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'ExtractionMapError'
    this.path = path
  }
}

/** Parse and validate an extraction map from raw JSON text. */
export function parseExtractionMap(source: string): ExtractionMap {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new ExtractionMapError('', `invalid JSON: ${errorMessage(error)}`)
  }
  assertDescriptorMap(parsed, '')
  return parsed
}

/** Evaluate a validated map against one parsed document into one JSON object. */
export function evaluateExtractionMap(
  document: PdfStructureDocument,
  map: ExtractionMap
): Record<string, unknown> {
  return evaluateMap(map, (selector) => document.query(selector), '')
}

type ScopeQuery = (selector: string) => readonly QueryNode[]

function evaluateMap(
  map: ExtractionMap,
  query: ScopeQuery,
  path: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(map)) {
    result[key] = evaluateDescriptor(descriptor, query, joinPath(path, key))
  }
  return result
}

function evaluateDescriptor(
  descriptor: ExtractionDescriptor,
  query: ScopeQuery,
  path: string
): unknown {
  if (typeof descriptor === 'string') {
    const matches = runQuery(query, descriptor, path)
    return matches.length === 0 ? null : projectText(matches[0])
  }

  if (Array.isArray(descriptor)) {
    const inner = descriptor[0] as ExtractionDescriptor
    if (typeof inner === 'string') {
      return runQuery(query, inner, `${path}[0]`).map(projectText)
    }
    const descriptorObject = inner as Extract<ExtractionDescriptor, { selector: string }>
    const matches = runQuery(query, descriptorObject.selector, `${path}[0].selector`)
    return matches.map((node, index) =>
      projectDescriptorValue(node, descriptorObject, `${path}[${index}]`))
  }

  const objectDescriptor = descriptor as Extract<ExtractionDescriptor, { selector: string }>
  const matches = runQuery(query, objectDescriptor.selector, `${path}.selector`)
  return matches.length === 0
    ? null
    : projectDescriptorValue(matches[0], objectDescriptor, path)
}

function projectDescriptorValue(
  node: QueryNode,
  descriptor: Extract<ExtractionDescriptor, { selector: string }>,
  path: string
): unknown {
  const value = descriptor.value
  if (value === undefined) return projectText(node)
  if (typeof value === 'string') return projectField(node, value, `${path}.value`)

  const scope: ScopeQuery = (selector) =>
    queryStructureNodes([...node.children] as QueryNode[], selector)
  return evaluateMap(value, scope, `${path}.value`)
}

function projectText(node: QueryNode): string {
  return node.text
}

function projectField(node: QueryNode, field: string, path: string): unknown {
  const snapshot = node.toJSON() as Record<string, unknown>
  if (!(field in snapshot)) {
    throw new ExtractionMapError(
      path,
      `unknown serialized field ${JSON.stringify(field)}; available: ${Object.keys(snapshot).join(', ')}`
    )
  }
  return snapshot[field] ?? null
}

function runQuery(query: ScopeQuery, selector: string, path: string): readonly QueryNode[] {
  try {
    return query(selector)
  } catch (error) {
    throw new ExtractionMapError(path, errorMessage(error))
  }
}

function assertDescriptorMap(value: unknown, path: string): asserts value is ExtractionMap {
  if (!isPlainObject(value)) {
    throw new ExtractionMapError(path, 'extraction map must be a JSON object')
  }
  for (const [key, descriptor] of Object.entries(value)) {
    assertDescriptor(descriptor, joinPath(path, key))
  }
}

function assertDescriptor(value: unknown, path: string): asserts value is ExtractionDescriptor {
  if (typeof value === 'string') return
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      throw new ExtractionMapError(path, 'array descriptors must contain exactly one entry')
    }
    if (Array.isArray(value[0])) {
      throw new ExtractionMapError(path, 'array descriptors cannot nest another array')
    }
    assertDescriptor(value[0], `${path}[0]`)
    return
  }
  if (isPlainObject(value)) {
    const descriptor = value as { selector?: unknown; value?: unknown }
    for (const key of Object.keys(value)) {
      if (key !== 'selector' && key !== 'value') {
        throw new ExtractionMapError(path, `unknown descriptor key ${JSON.stringify(key)}; only "selector" and "value" are supported`)
      }
    }
    if (typeof descriptor.selector !== 'string' || descriptor.selector.trim() === '') {
      throw new ExtractionMapError(path, 'descriptor objects require a non-empty "selector" string')
    }
    if (descriptor.value !== undefined) {
      if (typeof descriptor.value === 'string') return
      assertDescriptorMap(descriptor.value, `${path}.value`)
    }
    return
  }
  throw new ExtractionMapError(
    path,
    'entries must be a selector string, a single-element array, or a {selector, value} descriptor'
  )
}

function joinPath(base: string, key: string): string {
  return base ? `${base}.${key}` : key
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
