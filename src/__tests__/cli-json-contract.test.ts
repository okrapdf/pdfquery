import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
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

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout)
}

describe('pdfquery CLI JSON contract', () => {
  it('emits multiple matches in document-query order', async () => {
    const result = await run([fixturePath, '*', '-o', 'json'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(parseJson(result.stdout)).toMatchObject({
      selector: '*',
      count: 3,
      results: [
        { id: 'page-1', role: 'page', page: 1, pages: [1], text: 'Quarterly revenue' },
        { id: 'struct-7-0', role: 'Root', rawRole: 'StructTreeRoot', parent: null },
        { id: 'struct-6-0', role: 'H1', rawRole: 'ReportHeading', text: 'Quarterly revenue' }
      ],
      diagnostics: []
    })
  })

  it('de-duplicates overlapping selector groups by node identity', async () => {
    const result = await run([fixturePath, 'H1,H1', '-o', 'json'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(parseJson(result.stdout)).toMatchObject({
      selector: 'H1,H1',
      count: 1,
      results: [{ id: 'struct-6-0', role: 'H1' }],
      diagnostics: []
    })
  })

  it('returns zero matches as a successful empty JSON envelope', async () => {
    const result = await run([fixturePath, 'H6', '-o', 'json'])

    expect(result).toEqual({
      code: 0,
      stdout: '{\n  "selector": "H6",\n  "count": 0,\n  "results": [],\n  "diagnostics": []\n}\n',
      stderr: ''
    })
  })

  it('documents the virtual page result shape', async () => {
    const result = await run([fixturePath, 'page[page=1]', '-o', 'json'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(parseJson(result.stdout)).toEqual({
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
  })

  it('keeps operational errors on stderr so stdout remains JSON-only', async () => {
    const result = await run(['/definitely/missing.pdf', 'H1', '-o', 'json'])

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^Error: /)
  })
})

describe('pdfquery CLI JSON diagnostics contract', () => {
  it('passes parser diagnostics through the JSON envelope', async () => {
    vi.resetModules()
    vi.doMock('@okrapdf/pdfdom/native', () => ({
      openTaggedPdf: vi.fn(async () => ({
        query: () => [
          {
            toJSON: () => ({
              id: 'struct-warning',
              role: 'H1',
              rawRole: null,
              parent: null,
              children: [],
              text: 'Recovered heading',
              ownText: 'Recovered heading',
              page: 1,
              pages: [1],
              mcids: [],
              content: [],
              language: null,
              bbox: null,
              bboxes: [],
              attributes: {},
              rawAttributes: {}
            }),
            text: 'Recovered heading'
          }
        ],
        diagnostics: [{ level: 'warning', message: 'recovered malformed structure node' }]
      }))
    }))

    const { runPdfQueryCli: runMockedCli } = await import('../cli.js')
    let stdout = ''
    let stderr = ''
    const code = await runMockedCli(['fixture.pdf', 'H1', '-o', 'json'], {
      readFile: async () => new Uint8Array([37, 80, 68, 70]),
      stdout: (text) => { stdout += text },
      stderr: (text) => { stderr += text }
    })

    expect(code).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      selector: 'H1',
      count: 1,
      results: [
        {
          id: 'struct-warning',
          role: 'H1',
          rawRole: null,
          parent: null,
          children: [],
          text: 'Recovered heading',
          ownText: 'Recovered heading',
          page: 1,
          pages: [1],
          mcids: [],
          content: [],
          language: null,
          bbox: null,
          bboxes: [],
          attributes: {},
          rawAttributes: {}
        }
      ],
      diagnostics: [{ level: 'warning', message: 'recovered malformed structure node' }]
    })

    vi.doUnmock('@okrapdf/pdfdom/native')
  })
})
