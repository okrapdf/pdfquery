import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixture = join(repo, 'fixtures', 'tagged-report.pdf')
const temp = mkdtempSync(join(tmpdir(), 'pdfquery-package-'))

try {
  const packJson = execFileSync('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temp
  ], { cwd: repo, encoding: 'utf8' })
  const [{ filename }] = JSON.parse(packJson)
  const tarball = join(temp, filename)
  const packedManifest = JSON.parse(execFileSync(
    'tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }
  ))
  if (packedManifest.bin?.pdfquery !== './dist/cli.js') {
    throw new Error('packed artifact does not expose the pdfquery executable')
  }

  const packedCli = execFileSync(
    'tar', ['-xOf', tarball, 'package/dist/cli.js'], { encoding: 'utf8' }
  )
  if (packedCli.includes('@okrapdf/pdfdom')) {
    throw new Error('packed CLI leaks a runtime @okrapdf/pdfdom import')
  }

  const result = spawnSync('npx', [
    '--yes',
    '--package',
    tarball,
    '--',
    'pdfquery',
    fixture,
    'H1'
  ], {
    cwd: temp,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: join(temp, 'npm-cache'),
      npm_config_update_notifier: 'false'
    }
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`packed npx exited ${result.status}: ${result.stderr}`)
  }
  if (result.stdout !== 'Quarterly revenue\n') {
    throw new Error(`unexpected packed npx output: ${JSON.stringify(result.stdout)}`)
  }
  process.stdout.write(`packed npx ok: ${result.stdout}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
