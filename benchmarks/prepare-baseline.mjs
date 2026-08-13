import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselineRoot = resolve(root, '.benchmark-baseline')
const pdfquerySource = process.env.PDFQUERY_BASELINE_SOURCE ?? root
const pdfdomSource = process.env.PDFDOM_BASELINE_SOURCE ?? resolve(root, '..', 'pdfdom')
const pdfqueryRevision = 'a8c511b46e80724900465f150f40a0478405b46c'
const pdfdomRevision = '64335178f13c43fa9f560d18dc729719d2f157bf'
const pdfqueryWorktree = resolve(baselineRoot, 'pdfquery')
const pdfdomWorktree = resolve(baselineRoot, 'pdfdom')

function git(source, ...args) {
  execFileSync('git', ['-C', source, ...args], { stdio: 'inherit' })
}

await mkdir(baselineRoot, { recursive: true })
for (const [source, worktree] of [[pdfquerySource, pdfqueryWorktree], [pdfdomSource, pdfdomWorktree]]) {
  try {
    git(source, 'worktree', 'remove', '--force', worktree)
  } catch {
    await rm(worktree, { recursive: true, force: true })
    git(source, 'worktree', 'prune')
  }
}

git(pdfdomSource, 'worktree', 'add', '--detach', pdfdomWorktree, pdfdomRevision)
git(pdfquerySource, 'worktree', 'add', '--detach', pdfqueryWorktree, pdfqueryRevision)

execFileSync('npm', ['ci'], { cwd: pdfdomWorktree, stdio: 'inherit' })
execFileSync('npm', ['run', 'build'], { cwd: pdfdomWorktree, stdio: 'inherit' })
execFileSync('npm', ['ci'], { cwd: pdfqueryWorktree, stdio: 'inherit' })

const tsconfigPath = resolve(pdfqueryWorktree, 'tsconfig.json')
const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8'))
tsconfig.compilerOptions.baseUrl = '.'
tsconfig.compilerOptions.paths = {
  '@okrapdf/pdfdom/native': [resolve(pdfdomWorktree, 'src', 'native.ts')]
}
await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
execFileSync('npm', ['run', 'build'], { cwd: pdfqueryWorktree, stdio: 'inherit' })

process.stdout.write(`${baselineRoot}\n`)
