import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createCurrentAdapter } from './current-adapter.mjs'

const [engine, workload, pdfPath, selector, countText = '1'] = process.argv.slice(2)
if (!engine || !workload || !pdfPath || !selector) {
  throw new Error('usage: worker.mjs <baseline|current> <process-total|steady-query> <pdf> <selector> [count]')
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselineRoot = process.env.PDFQUERY_BENCHMARK_BASELINE ?? resolve(root, '.benchmark-baseline')
const count = Number.parseInt(countText, 10)
let sink = 0

if (workload === 'process-total') {
  const cli = engine === 'baseline'
    ? resolve(baselineRoot, 'pdfquery', 'dist', 'cli.js')
    : resolve(root, 'dist', 'cli.js')
  const { runPdfQueryCli } = await import(pathToFileURL(cli).href)
  const code = await runPdfQueryCli([pdfPath, selector, '-o', 'size'], {
    stdout(text) { sink ^= Number.parseInt(text, 10) || 0 },
    stderr(text) { process.stderr.write(text) }
  })
  if (code !== 0) process.exitCode = code
  else process.stdout.write(`${sink}\n`)
} else if (workload === 'steady-query') {
  const bytes = new Uint8Array(await readFile(pdfPath))
  const document = engine === 'baseline'
    ? await openBaseline(bytes)
    : await openCurrent(bytes)
  document.query(selector)
  for (let index = 0; index < count; index += 1) sink ^= document.query(selector).length
  document.free?.()
  process.stdout.write(`${sink}\n`)
} else {
  throw new Error(`unknown workload: ${workload}`)
}

async function openBaseline(bytes) {
  const modulePath = resolve(baselineRoot, 'pdfdom', 'dist', 'native.mjs')
  const { openTaggedPdf } = await import(pathToFileURL(modulePath).href)
  return openTaggedPdf(bytes)
}

async function openCurrent(bytes) {
  return createCurrentAdapter(root).open(bytes)
}
