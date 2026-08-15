#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  openTaggedPdf,
  type PdfStructureDocument,
  type PdfStructureNode,
  type PdfStructurePage
} from '@okrapdf/pdfdom/native'
import { evaluateExtractionMap, parseExtractionMap } from './extract.js'

declare const PDFQUERY_VERSION: string

type OutputFormat = 'text' | 'json' | 'json-array' | 'jsonl' | 'size'
type QueryNode = PdfStructureNode | PdfStructurePage

interface CliOptions {
  source?: string
  selector?: string
  output: OutputFormat
  attribute?: string
  extract?: string
  extractFile?: string
  help: boolean
  version: boolean
}

export interface PdfQueryCliIo {
  stdout(text: string): void
  stderr(text: string): void
  readFile(path: string): Promise<Uint8Array>
  readStdin(): Promise<Uint8Array>
  /** @internal Test hook replacing the tagged-PDF opener. */
  openDocument?(bytes: Uint8Array): Promise<PdfStructureDocument>
}

const defaultIo: PdfQueryCliIo = {
  stdout: (text) => { process.stdout.write(text) },
  stderr: (text) => { process.stderr.write(text) },
  readFile: async (path) => new Uint8Array(await readFile(path)),
  readStdin: async () => new Uint8Array(readFileSync(0)),
  openDocument: (bytes) => openTaggedPdf(bytes)
}

export async function runPdfQueryCli(
  argv: readonly string[] = process.argv.slice(2),
  io: Partial<PdfQueryCliIo> = {}
): Promise<number> {
  const streams = { ...defaultIo, ...io }
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    streams.stderr(`Error: ${errorMessage(error)}\n`)
    return 1
  }

  if (options.version) {
    streams.stdout(`${PDFQUERY_VERSION}\n`)
    return 0
  }
  if (options.help || argv.length === 0) {
    streams.stdout(helpText())
    return 0
  }
  if (!options.source) {
    streams.stderr('Error: a PDF path is required.\n')
    return 1
  }
  const extractMode = options.extract !== undefined || options.extractFile !== undefined
  if (!extractMode && !options.selector) {
    streams.stderr('Error: a selector is required.\n')
    return 1
  }

  try {
    let stdinBytes: Uint8Array | undefined
    const readStdinOnce = async () => {
      stdinBytes ??= await streams.readStdin()
      return stdinBytes
    }

    const bytes = options.source === '-'
      ? await readStdinOnce()
      : await streams.readFile(options.source)
    if (bytes.byteLength === 0) throw new Error('received an empty PDF source')

    const openDocument = streams.openDocument ?? openTaggedPdf
    const document = await openDocument(bytes)

    if (extractMode) {
      const rawMap = options.extract !== undefined
        ? options.extract
        : options.extractFile === '-'
          ? new TextDecoder().decode(await readStdinOnce())
          : new TextDecoder().decode(await streams.readFile(options.extractFile!))
      const map = parseExtractionMap(rawMap)
      const result = evaluateExtractionMap(document, map)
      streams.stdout(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }

    const results = document.query(options.selector!)
    streams.stdout(formatResults(options, results, document.diagnostics))
    return 0
  } catch (error) {
    streams.stderr(`Error: ${errorMessage(error)}\n`)
    return 1
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
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
      case '--extract':
      case '-e':
        options.extract = readValue(argv, ++index, arg)
        break
      case '--extract-file':
      case '-E':
        options.extractFile = readValue(argv, ++index, arg)
        break
      default:
        if (arg.startsWith('-') && arg !== '-') throw new Error(`unknown argument: ${arg}`)
        positional.push(arg)
    }
  }

  if (positional.length > 2) throw new Error(`unknown argument: ${positional[2]}`)
  if (options.extract !== undefined && options.extractFile !== undefined) {
    throw new Error('--extract cannot be combined with --extract-file')
  }
  const extractMode = options.extract !== undefined || options.extractFile !== undefined
  if (extractMode) {
    if (positional[1] !== undefined) {
      throw new Error('--extract cannot be combined with a positional selector')
    }
    if (options.attribute) throw new Error('--extract cannot be combined with --attribute')
    if (options.output !== 'text') throw new Error('--extract cannot be combined with --output')
  }
  if (options.attribute && options.output !== 'text') {
    throw new Error('--attribute cannot be combined with --output json, json-array, jsonl, or size')
  }
  options.source = positional[0]
  options.selector = positional[1]
  if (options.source === '-' && options.extractFile === '-') {
    throw new Error('stdin cannot supply both the PDF and the extraction map')
  }
  return options
}

function parseOutput(value: string): OutputFormat {
  if (value === 'text' || value === 'json' || value === 'json-array' || value === 'jsonl' || value === 'size') {
    return value
  }
  throw new Error(`unknown output format ${JSON.stringify(value)}; expected text, json, json-array, jsonl, or size`)
}

function readValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value || (value.startsWith('-') && value !== '-')) throw new Error(`${flag} requires a value`)
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
  if (options.output === 'json') {
    return `${JSON.stringify({
      selector: options.selector,
      count: results.length,
      results: results.map((node) => node.toJSON()),
      diagnostics
    }, null, 2)}\n`
  }
  if (options.output === 'json-array') {
    return `${JSON.stringify(results.map((node) => node.toJSON()), null, 2)}\n`
  }
  if (options.output === 'jsonl') {
    return lines(results.map((node) => JSON.stringify(node.toJSON())))
  }
  return lines(results.map((node) => node.text))
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
  return `pdfquery ${PDFQUERY_VERSION}\n\nUsage:\n  pdfquery <file.pdf|-> <selector> [options]\n  pdfquery <file.pdf|-> --extract <json>\n  pdfquery <file.pdf|-> --extract-file <map.json|->\n\nOptions:\n  -o, --output <text|json|json-array|jsonl|size>  Output format (default: text)\n  -a, --attribute <name>        Print one node attribute per match\n  -e, --extract <json>          Evaluate an inline extraction map\n  -E, --extract-file <path|->   Read an extraction map from a file or stdin\n  -h, --help                    Show help\n  -v, --version                 Show version\n\nExamples:\n  pdfquery report.pdf 'H1'\n  pdfquery report.pdf 'Figure[alt*="revenue"]' -a alt\n  cat report.pdf | pdfquery - 'Table > TR > TD' -o json\n  pdfquery report.pdf 'H1' -o json | jq -r '.results[].text'\n  pdfquery report.pdf 'Sect:has(Figure)' -o jsonl | jq '.id'\n  pdfquery report.pdf -e '{"title":"H1","headings":["H2"]}' | jq '.title'\n`
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
