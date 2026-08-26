#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Effect, Schema } from 'effect'
import {
  openTaggedPdf,
  type NativeQueryNode
} from './native.js'

declare const PDFQUERY_VERSION: string

type OutputFormat = 'text' | 'json' | 'json-array' | 'jsonl' | 'size'
type QueryNode = NativeQueryNode

export class CliArgError extends Schema.TaggedError<CliArgError>()('CliArgError', {
  message: Schema.String
}) {}

export class PdfSourceError extends Schema.TaggedError<PdfSourceError>()('PdfSourceError', {
  message: Schema.String,
  cause: Schema.Defect()
}) {}

interface CliOptions {
  source?: string
  selector?: string
  output: OutputFormat
  attribute?: string
  help: boolean
  version: boolean
}

export interface PdfQueryCliIo {
  stdout(text: string): void
  stderr(text: string): void
  readFile(path: string): Promise<Uint8Array>
  readStdin(): Promise<Uint8Array>
}

const defaultIo: PdfQueryCliIo = {
  stdout: (text) => { process.stdout.write(text) },
  stderr: (text) => { process.stderr.write(text) },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  readStdin: async () => new Uint8Array(readFileSync(0))
}

export async function runPdfQueryCli(
  argv: readonly string[] = process.argv.slice(2),
  io: Partial<PdfQueryCliIo> = {}
): Promise<number> {
  const streams = { ...defaultIo, ...io }
  const program = Effect.gen(function*() {
    const options = yield* parseArgs(argv)

    if (options.version) {
      yield* Effect.sync(() => streams.stdout(`${PDFQUERY_VERSION}\n`))
      return 0
    }
    if (options.help || argv.length === 0) {
      yield* Effect.sync(() => streams.stdout(helpText()))
      return 0
    }
    if (!options.source) return yield* new CliArgError({ message: 'a PDF path is required.' })
    if (!options.selector) return yield* new CliArgError({ message: 'a selector is required.' })

    const bytes = yield* Effect.tryPromise({
      try: () => options.source === '-'
        ? streams.readStdin()
        : streams.readFile(options.source as string),
      catch: (cause) => new PdfSourceError({ message: errorMessage(cause), cause })
    })
    if (bytes.byteLength === 0) return yield* new PdfSourceError({ message: 'received an empty PDF source', cause: undefined })

    const document = yield* openTaggedPdf(bytes)
    const results = yield* document.query(options.selector)
    const diagnostics = yield* document.diagnostics
    yield* Effect.sync(() => streams.stdout(formatResults(options, results, diagnostics)))
    return 0
  })
  return Effect.runPromise(program.pipe(
    Effect.catch((error) => Effect.sync(() => {
      streams.stderr(`Error: ${error.message}\n`)
      return 1
    }))
  ))
}

function parseArgs(argv: readonly string[]): Effect.Effect<CliOptions, CliArgError> {
  return Effect.try({
    try: () => parseArgsUnsafe(argv),
    catch: (cause) => new CliArgError({ message: errorMessage(cause) })
  })
}

function parseArgsUnsafe(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    output: 'text',
    help: false,
    version: false
  }
  const positional: string[] = []
  let positionalOnly = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (positionalOnly) {
      positional.push(arg)
      continue
    }
    switch (arg) {
      case '--':
        positionalOnly = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--version':
      case '-v':
        options.version = true
        break
      case '--output':
      case '-o':
        options.output = parseOutput(readValue(argv, ++index, arg))
        break
      case '--attribute':
      case '-a':
        options.attribute = readValue(argv, ++index, arg)
        break
      default:
        if (arg.startsWith('-') && arg !== '-') throw new Error(`unknown argument: ${arg}`)
        positional.push(arg)
    }
  }

  if (positional.length > 2) throw new Error(`unknown argument: ${positional[2]}`)
  if (options.attribute && options.output !== 'text') {
    if (options.output === 'json' || options.output === 'size') {
      throw new Error('--attribute cannot be combined with --output json or size')
    }
    throw new Error(`--attribute cannot be combined with --output ${options.output}`)
  }
  options.source = positional[0]
  options.selector = positional[1]
  return options
}

function parseOutput(value: string): OutputFormat {
  if (
    value === 'text' ||
    value === 'json' ||
    value === 'json-array' ||
    value === 'jsonl' ||
    value === 'size'
  ) return value
  throw new Error(
    `unknown output format ${JSON.stringify(value)}; expected text, json, json-array, jsonl, or size`
  )
}

function readValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`)
  return value
}

function formatResults(
  options: CliOptions,
  results: readonly QueryNode[],
  diagnostics: readonly unknown[]
): string {
  if (options.attribute) {
    return lines(results.map((node) => formatValue(readAttribute(node, options.attribute!))))
  }
  if (options.output === 'size') return `${results.length}\n`
  if (options.output === 'text') return lines(results.map((node) => node.text))
  const serializedResults = results.map((node) => node.toJSON())
  if (options.output === 'json') {
    return `${JSON.stringify({
      selector: options.selector,
      count: results.length,
      results: serializedResults,
      diagnostics
    }, null, 2)}\n`
  }
  if (options.output === 'json-array') {
    return `${JSON.stringify(serializedResults, null, 2)}\n`
  }
  if (options.output === 'jsonl') {
    return lines(serializedResults.map((result) => JSON.stringify(result)))
  }
  throw new Error(`unsupported output format: ${options.output}`)
}

function lines(values: readonly string[]): string {
  return values.length === 0 ? '' : `${values.join('\n')}\n`
}

function readAttribute(node: QueryNode, name: string): unknown {
  const aliases: Readonly<Record<string, readonly string[]>> = {
    alt: ['altText', 'alt'],
    actualtext: ['actualText', 'actual-text'],
    'actual-text': ['actualText', 'actual-text'],
    lang: ['language', 'lang'],
    page: ['page'],
    role: ['role', 'type'],
    type: ['type', 'role']
  }
  const keys = aliases[name.toLowerCase()] ?? [name]
  for (const key of keys) {
    const value = readProperty(node, key)
    if (value !== undefined && value !== null) return value
  }
  const attributes = readProperty(node, 'attributes')
  for (const key of keys) {
    const value = readProperty(attributes, key)
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function readProperty(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function helpText(): string {
  return `pdfquery ${PDFQUERY_VERSION}\n\nUsage:\n  pdfquery <file.pdf|-> <selector> [options]\n\nOptions:\n  -o, --output <text|json|json-array|jsonl|size>\n                                Output format (default: text)\n  -a, --attribute <name>        Print one node attribute per match\n  -h, --help                    Show help\n  -v, --version                 Show version\n\nExamples:\n  pdfquery report.pdf 'H1'\n  pdfquery report.pdf 'Figure[alt*="revenue"]' -a alt\n  cat report.pdf | pdfquery - 'Table > TR > TD' -o json\n  pdfquery report.pdf 'H1' -o json-array | jq '.[]'\n  pdfquery report.pdf 'H1' -o jsonl | jq -c 'select(.page == 1)'\n`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href
      === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
  } catch {
    return false
  }
}

if (isDirectExecution()) {
  void runPdfQueryCli().then((code) => { process.exitCode = code })
}
