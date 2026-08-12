import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runPdfQueryCli } from '../cli.js'

const fixturePath = fileURLToPath(new URL('../../fixtures/tagged-report.pdf', import.meta.url))

async function run(argv: string[]) {
  let stdout = ''
  let stderr = ''
  const code = await runPdfQueryCli(argv, {
    stdout: (text) => { stdout += text },
    stderr: (text) => { stderr += text }
  })
  return { code, stdout, stderr }
}

describe('pdfquery CLI', () => {
  it('prints matched text by default', async () => {
    expect(await run([fixturePath, 'H1'])).toEqual({
      code: 0,
      stdout: 'Quarterly revenue\n',
      stderr: ''
    })
  })

  it('supports size, JSON, and attribute output', async () => {
    expect(await run([fixturePath, 'H1', '-o', 'size'])).toEqual({
      code: 0,
      stdout: '1\n',
      stderr: ''
    })
    expect(await run([fixturePath, 'H1', '-a', 'role'])).toEqual({
      code: 0,
      stdout: 'H1\n',
      stderr: ''
    })

    const json = await run([fixturePath, 'H1', '--output', 'json'])
    expect(json.code).toBe(0)
    expect(json.stderr).toBe('')
    expect(JSON.parse(json.stdout)).toMatchObject({
      selector: 'H1',
      count: 1,
      results: [{ role: 'H1', rawRole: 'ReportHeading', text: 'Quarterly revenue' }]
    })
  })

  it('returns an empty stream for no text matches', async () => {
    expect(await run([fixturePath, 'H6'])).toEqual({ code: 0, stdout: '', stderr: '' })
  })

  it('reports argument and input errors without a stack trace', async () => {
    expect(await run([fixturePath])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Error: a selector is required.\n'
    })
    const missing = await run(['/definitely/missing.pdf', 'H1'])
    expect(missing.code).toBe(1)
    expect(missing.stdout).toBe('')
    expect(missing.stderr).toMatch(/^Error: /)
    expect(missing.stderr).not.toContain('\n    at ')
  })

  it('prints help and version without reading a PDF', async () => {
    const help = await run(['--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain("pdfquery <file.pdf|-> <selector>")
    expect(help.stdout).toContain(
      '  -o, --output <text|json|json-array|jsonl|size>\n' +
      '                                Output format (default: text)\n'
    )
    expect(help.stdout).not.toContain('\n+                                Output format')
    expect(help.stdout).toContain("-o json-array | jq '.[]'")
    expect(help.stdout).toContain("-o jsonl | jq -c 'select(.page == 1)'")
    expect(await run(['--version'])).toEqual({ code: 0, stdout: '0.3.0\n', stderr: '' })
  })
})
