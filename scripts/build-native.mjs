import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const nativeRoot = resolve(root, 'native')
const generated = resolve(nativeRoot, 'pkg')
const output = resolve(root, 'dist', 'native')

const expectedWasmPackVersion = 'wasm-pack 0.15.0'
let wasmPackVersion
try {
  wasmPackVersion = execFileSync('wasm-pack', ['--version'], {
    cwd: root,
    encoding: 'utf8'
  }).trim()
} catch {
  throw new Error(`${expectedWasmPackVersion} is required to build the Rust PDF engine`)
}
if (wasmPackVersion !== expectedWasmPackVersion) {
  throw new Error(
    `${expectedWasmPackVersion} is required; found ${JSON.stringify(wasmPackVersion)}`
  )
}

execFileSync('wasm-pack', [
  'build', nativeRoot,
  '--target', 'nodejs',
  '--release',
  '--out-dir', 'pkg',
  '--', '--locked'
], { cwd: root, stdio: 'inherit' })

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const binding = await readFile(resolve(generated, 'pdfquery_native.js'), 'utf8')
await writeFile(
  resolve(output, 'pdfquery_native.cjs'),
  binding
)
await cp(
  resolve(generated, 'pdfquery_native_bg.wasm'),
  resolve(output, 'pdfquery_native_bg.wasm')
)
