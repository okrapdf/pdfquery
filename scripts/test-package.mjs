import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixture = join(repo, 'fixtures', 'tagged-report.pdf')
const temp = mkdtempSync(join(tmpdir(), 'pdfquery-package-'))
const MAX_TARBALL_BYTES = 2 * 1024 * 1024

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
