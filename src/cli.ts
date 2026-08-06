#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  openTaggedPdf,
  type PdfStructureNode,
  type PdfStructurePage
} from '@okrapdf/pdfdom/native'

declare const PDFQUERY_VERSION: string

type OutputFormat = 'text' | 'json' | 'size'
type QueryNode = PdfStructureNode | PdfStructurePage

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
  if (!options.selector) {
    streams.stderr('Error: a selector is required.\n')
    return 1
  }

  try {
    const bytes = options.source === '-'
      ? await streams.readStdin()
      : await streams.readFile(options.source)
    if (bytes.byteLength === 0) throw new Error('received an empty PDF source')

    const document = await openTaggedPdf(bytes)
    const results = document.query(options.selector)
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
      default:
        if (arg.startsWith('-') && arg !== '-') throw new Error(`unknown argument: ${arg}`)
        positional.push(arg)
    }
  }

  if (positional.length > 2) throw new Error(`unknown argument: ${positional[2]}`)
  if (options.attribute && options.output !== 'text') {
    throw new Error('--attribute cannot be combined with --output json or size')
  }
  options.source = positional[0]
  options.selector = positional[1]
  return options
}

function parseOutput(value: string): OutputFormat {
  if (value === 'text' || value === 'json' || value === 'size') return value
  throw new Error(`unknown output format ${JSON.stringify(value)}; expected text, json, or size`)
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
  if (options.output === 'json') {
    return `${JSON.stringify({
      selector: options.selector,
      count: results.length,
      results: results.map((node) => node.toJSON()),
      diagnostics
    }, null, 2)}\n`
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
  return `pdfquery ${PDFQUERY_VERSION}\n\nUsage:\n  pdfquery <file.pdf|-> <selector> [options]\n\nOptions:\n  -o, --output <text|json|size>  Output format (default: text)\n  -a, --attribute <name>        Print one node attribute per match\n  -h, --help                    Show help\n  -v, --version                 Show version\n\nExamples:\n  pdfquery report.pdf 'H1'\n  pdfquery report.pdf 'Figure[alt*="revenue"]' -a alt\n  cat report.pdf | pdfquery - 'Table > TR > TD' -o json\n`
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
