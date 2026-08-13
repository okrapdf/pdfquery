import { readFile } from 'node:fs/promises'

const MAX_WASM_BYTES = 4 * 1024 * 1024

const cli = await readFile(new URL('../dist/cli.js', import.meta.url), 'utf8')
if (!cli.startsWith('#!/usr/bin/env node\n')) {
  throw new Error('dist/cli.js is missing its node shebang')
}
if (cli.includes('@okrapdf/pdfdom') || cli.includes('pdfjs-dist') || cli.includes('pdf-lib')) {
  throw new Error('dist/cli.js still contains the retired JavaScript PDF backend')
}
const nativeBinding = await readFile(new URL('../dist/native/pdfquery_native.cjs', import.meta.url), 'utf8')
if (!nativeBinding.includes('pdfquery_native_bg.wasm')) {
  throw new Error('dist/native is missing its Rust WebAssembly binding')
}
const nativeWasm = await readFile(new URL('../dist/native/pdfquery_native_bg.wasm', import.meta.url))
if (nativeWasm.byteLength > MAX_WASM_BYTES) {
  throw new Error(
    `Rust WebAssembly exceeds ${MAX_WASM_BYTES} bytes: ${nativeWasm.byteLength}`
  )
}
