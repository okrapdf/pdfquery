import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixture = join(repo, 'fixtures', 'tagged-report.pdf')
const temp = mkdtempSync(join(tmpdir(), 'pdfquery-package-'))
const MAX_TARBALL_BYTES = 2 * 1024 * 1024

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: temp,
    encoding: 'utf8',
    ...options
  })
  if (result.error) throw result.error
  return result
}

function assertSuccess(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} exited ${result.status}: ${result.stderr}`
  )
  assert.equal(result.stderr, '', `${label} wrote to stderr`)
}

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
  const tarballBytes = statSync(tarball).size
  if (tarballBytes > MAX_TARBALL_BYTES) {
    throw new Error(
      `packed tarball exceeds ${MAX_TARBALL_BYTES} bytes: ${tarballBytes}`
    )
  }
  const packedManifest = JSON.parse(execFileSync(
    'tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }
  ))
  if (packedManifest.bin?.pdfquery !== './dist/cli.js') {
    throw new Error('packed artifact does not expose the pdfquery executable')
  }

  const thirdPartyNotices = execFileSync(
    'tar', ['-xOf', tarball, 'package/THIRD_PARTY_NOTICES'], { encoding: 'utf8' }
  )
  const requiredNotices = [
    ['## pdf-inspector 1.14.1', ['MIT License', 'Copyright (c) 2026 Firecrawl', 'Permission is hereby granted']],
    ['## Adobe CMap resources', ['Copyright 1990-2009 Adobe Systems Incorporated', 'Redistribution and use in source and binary forms']],
    ['## lopdf 0.42.0', ['MIT License', 'Copyright (c) 2016 Junfeng Liu', 'Permission is hereby granted']]
  ]
  for (const [heading, requiredText] of requiredNotices) {
    const start = thirdPartyNotices.indexOf(heading)
    const next = thirdPartyNotices.indexOf('\n## ', start + heading.length)
    const notice = start === -1
      ? ''
      : thirdPartyNotices.slice(start, next === -1 ? undefined : next)
    if (requiredText.some((text) => !notice.includes(text))) {
      throw new Error(`packed artifact is missing the required ${heading.slice(3)} notice`)
    }
  }

  const packedCli = execFileSync(
    'tar', ['-xOf', tarball, 'package/dist/cli.js'], { encoding: 'utf8' }
  )
  if (packedCli.includes('@okrapdf/pdfdom') || packedCli.includes('pdfjs-dist')) {
    throw new Error('packed CLI leaks the retired JavaScript PDF backend')
  }

  execFileSync(
    'tar', ['-xOf', tarball, 'package/dist/native/pdfquery_native_bg.wasm'],
    { stdio: 'ignore' }
  )

  const result = run('npx', [
    '--yes',
    '--package',
    tarball,
    '--',
    'pdfquery',
    fixture,
    'H1'
  ], {
    env: {
      ...process.env,
      npm_config_cache: join(temp, 'npx-cache'),
      npm_config_update_notifier: 'false'
    }
  })
  assertSuccess(result, 'packed npx')
  assert.equal(result.stdout, 'Quarterly revenue\n', 'unexpected packed npx output')

  const installPrefix = join(temp, 'installed')
  const install = run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefix',
    installPrefix,
    tarball
  ], {
    env: {
      ...process.env,
      npm_config_cache: join(temp, 'install-cache'),
      npm_config_update_notifier: 'false'
    }
  })
  assertSuccess(install, 'packed install')

  const installedPackage = join(installPrefix, 'node_modules', 'pdfquery')
  const installedFixture = join(installedPackage, 'fixtures', 'tagged-report.pdf')
  const installedCli = join(
    installPrefix,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'pdfquery.cmd' : 'pdfquery'
  )
  const builtCli = join(repo, 'dist', 'cli.js')
  const missingFixture = join(temp, 'missing.pdf')

  function runBuilt(args) {
    return run(process.execPath, [builtCli, ...args])
  }

  function runPacked(args) {
    return run(installedCli, args)
  }

  function assertPackedJsonContract(selector) {
    const built = runBuilt([fixture, selector, '-o', 'json'])
    const packed = runPacked([installedFixture, selector, '-o', 'json'])
    assertSuccess(built, `built JSON contract for ${selector}`)
    assertSuccess(packed, `packed JSON contract for ${selector}`)
    assert.equal(
      packed.stdout,
      built.stdout,
      `packed JSON contract differs from the tested build for ${selector}`
    )
    return { output: packed.stdout, payload: JSON.parse(packed.stdout) }
  }

  const ordered = assertPackedJsonContract('*').payload
  assert.deepEqual({
    selector: ordered.selector,
    count: ordered.count,
    ids: ordered.results.map((node) => node.id),
    diagnostics: ordered.diagnostics
  }, {
    selector: '*',
    count: 3,
    ids: ['page-1', 'struct-7-0', 'struct-6-0'],
    diagnostics: []
  })

  const duplicate = assertPackedJsonContract('H1,H1').payload
  assert.deepEqual({
    selector: duplicate.selector,
    count: duplicate.count,
    ids: duplicate.results.map((node) => node.id),
    diagnostics: duplicate.diagnostics
  }, {
    selector: 'H1,H1',
    count: 1,
    ids: ['struct-6-0'],
    diagnostics: []
  })

  const empty = assertPackedJsonContract('H6')
  assert.equal(
    empty.output,
    '{\n  "selector": "H6",\n  "count": 0,\n  "results": [],\n  "diagnostics": []\n}\n'
  )

  const page = assertPackedJsonContract('page[page=1]').payload
  assert.deepEqual(page, {
    selector: 'page[page=1]',
    count: 1,
    results: [
      {
        id: 'page-1',
        role: 'page',
        page: 1,
        pages: [1],
        text: 'Quarterly revenue',
        width: 612,
        height: 792
      }
    ],
    diagnostics: []
  })

  const builtError = runBuilt([missingFixture, 'H1', '-o', 'json'])
  const packedError = runPacked([missingFixture, 'H1', '-o', 'json'])
  assert.equal(builtError.status, 1)
  assert.equal(packedError.status, 1)
  assert.equal(packedError.stdout, '')
  assert.equal(packedError.stderr, builtError.stderr)
  assert.match(packedError.stderr, /^Error: [^\n]+\n$/)

  process.stdout.write(`packed npx and JSON contract ok: ${result.stdout}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
