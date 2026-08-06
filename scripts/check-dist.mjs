import { readFile } from 'node:fs/promises'

const cli = await readFile(new URL('../dist/cli.js', import.meta.url), 'utf8')
if (!cli.startsWith('#!/usr/bin/env node\n')) {
  throw new Error('dist/cli.js is missing its node shebang')
}
if (cli.includes('@okrapdf/pdfdom')) {
  throw new Error('dist/cli.js still resolves @okrapdf/pdfdom at runtime')
}
if (!cli.includes('pdfjs-dist/legacy/build/pdf.mjs')) {
  throw new Error('dist/cli.js is missing the native tagged-PDF implementation')
}
