import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCurrentAdapter } from './current-adapter.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselineRoot = process.env.PDFQUERY_BENCHMARK_BASELINE ?? resolve(root, '.benchmark-baseline')
const options = parseArgs(process.argv.slice(2))
const fixturePaths = options.pdfs.length > 0
  ? options.pdfs.map((path) => resolve(path))
  : [resolve(root, 'fixtures', 'tagged-report.pdf')]
const selectors = options.selectors.length > 0 ? options.selectors : ['H1', '*']
const engines = await loadEngines()
const report = {
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem()
  },
  revisions: {
    baselinePdfquery: gitRevision(resolve(baselineRoot, 'pdfquery')),
    baselinePdfdom: gitRevision(resolve(baselineRoot, 'pdfdom')),
    candidatePdfquery: gitRevision(root),
    candidateDirty: gitDirty(root)
  },
  artifacts: {
    candidateWasm: await fileMetadata(resolve(root, 'dist', 'native', 'pdfquery_native_bg.wasm')),
    baselineCli: await fileMetadata(resolve(baselineRoot, 'pdfquery', 'dist', 'cli.js')),
    candidateCli: await fileMetadata(resolve(root, 'dist', 'cli.js'))
  },
  methodology: {
    clock: 'process.hrtime.bigint',
    ordering: 'alternating baseline-first and candidate-first paired samples',
    processTotal: 'fresh Node process; cache-warm file read, backend load, parse, one query, count output, exit',
    open: 'backend modules and PDF bytes loaded before timing; document parse and extraction only',
    firstQuery: 'fresh parsed document; first query includes candidate one-time handle hydration',
    openAndFirstQuery: 'backend modules and PDF bytes loaded; document creation plus one query and handle materialization',
    steadyQuery: 'document and handles initialized before batched queries',
    garbageCollection: 'forced before paired in-process samples when --expose-gc is available, outside timing'
  },
  sampleCounts: options.samples,
  fixtures: []
}

let sink = 0
for (const fixturePath of fixturePaths) {
  const bytes = new Uint8Array(await readFile(fixturePath))
  const fixture = {
    name: basename(fixturePath),
    path: fixturePath,
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    selectors: []
  }

  for (const selector of selectors) {
    const baselineProbe = await engines.baseline.open(bytes)
    const candidateProbe = await engines.current.open(bytes)
    try {
      const baselineIds = baselineProbe.query(selector).map(nodeId)
      const candidateIds = candidateProbe.query(selector).map(nodeId)
      if (JSON.stringify(baselineIds) !== JSON.stringify(candidateIds)) {
        throw new Error(`${fixture.name} ${JSON.stringify(selector)} returned different ordered IDs`)
      }
      fixture.selectors.push(await benchmarkSelector({ fixturePath, bytes, selector, expectedIds: baselineIds }))
      process.stderr.write(`benchmarked ${fixture.name} ${JSON.stringify(selector)}\n`)
    } finally {
      baselineProbe.free?.()
      candidateProbe.free?.()
    }
  }
  report.fixtures.push(fixture)
}

report.sink = sink
const outputPath = options.output ?? resolve(
  root,
  'benchmarks',
  'results',
  `benchmark-${new Date().toISOString().replaceAll(':', '-')}.json`
)
await mkdir(resolve(outputPath, '..'), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
printSummary(report, outputPath)

async function benchmarkSelector({ fixturePath, bytes, selector, expectedIds }) {
  const processTotal = await pairedSamples(options.samples.process, async (engine) => {
    const start = now()
    const count = await runProcessWorker([
      resolve(root, 'benchmarks', 'worker.mjs'),
      engine,
      'process-total',
      fixturePath,
      selector
    ])
    sink ^= count
    return elapsed(start)
  })

  const open = await pairedSamples(options.samples.open, async (engine) => {
    const start = now()
    const document = await engines[engine].open(bytes)
    const milliseconds = elapsed(start)
    document.free?.()
    return milliseconds
  })

  const firstQuery = await pairedSamples(options.samples.first, async (engine) => {
    const document = await engines[engine].open(bytes)
    const start = now()
    const results = document.query(selector)
    const milliseconds = elapsed(start)
    sink ^= results.length
    document.free?.()
    return milliseconds
  })

  const openAndFirstQuery = await pairedSamples(options.samples.first, async (engine) => {
    const start = now()
    const document = await engines[engine].open(bytes)
    const results = document.query(selector)
    const milliseconds = elapsed(start)
    sink ^= results.length
    document.free?.()
    return milliseconds
  })

  const baselineDocument = await engines.baseline.open(bytes)
  const currentDocument = await engines.current.open(bytes)
  baselineDocument.query(selector)
  currentDocument.query(selector)
  const operationsPerSample = adaptiveBatch(expectedIds.length, bytes.byteLength, options.quick)
  const steadyQuery = await pairedSamples(options.samples.steady, async (engine) => {
    const document = engine === 'baseline' ? baselineDocument : currentDocument
    const start = now()
    for (let index = 0; index < operationsPerSample; index += 1) {
      sink ^= document.query(selector).length
    }
    return elapsed(start) / operationsPerSample
  })
  baselineDocument.free?.()
  currentDocument.free?.()

  return {
    selector,
    resultCount: expectedIds.length,
    resultIds: expectedIds,
    operationsPerSteadySample: operationsPerSample,
    processTotal: comparison(processTotal),
    open: comparison(open),
    firstQuery: comparison(firstQuery),
    openAndFirstQuery: comparison(openAndFirstQuery),
    steadyQuery: comparison(steadyQuery),
    candidateProtocolBytes: engines.current.protocolBytes(bytes, selector)
  }
}

async function pairedSamples(count, operation) {
  const samples = { baseline: [], current: [] }
  for (let index = 0; index < count; index += 1) {
    globalThis.gc?.()
    const order = index % 2 === 0 ? ['baseline', 'current'] : ['current', 'baseline']
    for (const engine of order) samples[engine].push(await operation(engine))
  }
  return samples
}

async function loadEngines() {
  const baselineModule = await import(pathToFileURL(
    resolve(baselineRoot, 'pdfdom', 'dist', 'native.mjs')
  ).href)
  const current = createCurrentAdapter(root)
  return {
    baseline: { open: (bytes) => baselineModule.openTaggedPdf(bytes) },
    current
  }
}

function comparison(samples) {
  const baseline = summarize(samples.baseline)
  const current = summarize(samples.current)
  return {
    baseline: { samplesMs: samples.baseline, summary: baseline },
    current: { samplesMs: samples.current, summary: current },
    currentToBaselineMedianRatio: current.medianMs / baseline.medianMs,
    medianSpeedup: baseline.medianMs / current.medianMs
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  const median = quantile(sorted, 0.5)
  return {
    n: samples.length,
    minMs: sorted[0],
    medianMs: median,
    p95Ms: quantile(sorted, 0.95),
    p25Ms: quantile(sorted, 0.25),
    p75Ms: quantile(sorted, 0.75),
    iqrMs: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    maxMs: sorted.at(-1),
    operationsPerSecondAtMedian: 1000 / median
  }
}

function quantile(sorted, probability) {
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function parseArgs(args) {
  const value = {
    pdfs: [], selectors: [], output: undefined, quick: false,
    samples: { process: 20, open: 12, first: 12, steady: 20 }
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--pdf') value.pdfs.push(required(args, ++index, arg))
    else if (arg === '--selector') value.selectors.push(required(args, ++index, arg))
    else if (arg === '--output') value.output = resolve(required(args, ++index, arg))
    else if (arg === '--quick') value.quick = true
    else if (arg.endsWith('-samples')) {
      const key = arg.slice(2, -'-samples'.length)
      if (!(key in value.samples)) throw new Error(`unknown option: ${arg}`)
      value.samples[key] = positiveInteger(required(args, ++index, arg), arg)
    } else throw new Error(`unknown option: ${arg}`)
  }
  if (value.quick) value.samples = { process: 3, open: 4, first: 4, steady: 5 }
  return value
}

function required(args, index, option) {
  if (!args[index]) throw new Error(`${option} requires a value`)
  return args[index]
}

function positiveInteger(text, option) {
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${option} requires a positive integer`)
  return value
}

function adaptiveBatch(resultCount, bytes, quick) {
  if (quick) return resultCount < 100 && bytes < 100_000 ? 50 : 1
  if (resultCount < 100 && bytes < 100_000) return 500
  if (resultCount < 2_000) return 10
  return 2
}

function now() { return process.hrtime.bigint() }
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1e6 }
function nodeId(node) { return String(node.id) }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex') }

async function fileMetadata(path) {
  const bytes = await readFile(path)
  return { path, bytes: bytes.byteLength, sha256: hash(bytes) }
}

function gitRevision(path) {
  return execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function gitDirty(path) {
  return execFileSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== ''
}

function printSummary(result, outputPath) {
  for (const fixture of result.fixtures) {
    for (const selector of fixture.selectors) {
      const fields = ['processTotal', 'openAndFirstQuery', 'steadyQuery']
        .map((name) => `${name} ${selector[name].medianSpeedup.toFixed(2)}x`)
        .join(', ')
      process.stdout.write(`${fixture.name} ${JSON.stringify(selector.selector)}: ${fields}\n`)
    }
  }
  process.stdout.write(`report: ${outputPath}\n`)
}

function runProcessWorker(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`benchmark worker exited ${code ?? signal}: ${stderr.trim()}`))
        return
      }
      resolvePromise(Number.parseInt(stdout, 10) || 0)
    })
  })
}
