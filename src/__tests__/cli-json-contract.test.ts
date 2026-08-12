import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { runPdfQueryCli, type PdfQueryCliIo } from '../cli.js'

const fixturePath = fileURLToPath(new URL('../../fixtures/tagged-report.pdf', import.meta.url))

const expectedHeadingResult = {
  id: 'struct-6-0',
  role: 'H1',
  rawRole: 'ReportHeading',
  parent: 'struct-7-0',
  children: [],
  text: 'Quarterly revenue',
  ownText: 'Quarterly revenue',
  page: 1,
  pages: [1],
  mcids: [0],
  content: [{ type: 'content', page: 1, mcid: 0 }],
  language: 'en-US',
  bbox: {
    x: 0.11764705882352941,
    y: 0.06915151515151516,
    width: 0.313843137254902,
    height: 0.030303030303030304,
    page: 1,
    source: 'text',
    coordinateSpace: 'normalized-page'
  },
  bboxes: [
    {
      x: 0.11764705882352941,
      y: 0.06915151515151516,
      width: 0.313843137254902,
      height: 0.030303030303030304,
      page: 1,
      source: 'text',
      coordinateSpace: 'normalized-page'
    }
  ],
  attributes: {
    Type: 'StructElem',
    S: 'ReportHeading',
    Pg: { ref: '3 0 R' },
    Lang: 'en-US',
    role: 'H1',
    type: 'H1',
    rawRole: 'ReportHeading',
    lang: 'en-US',
    language: 'en-US',
    page: 1,
    pages: [1],
    mcids: [0],
    bbox: {
      x: 0.11764705882352941,
      y: 0.06915151515151516,
      width: 0.313843137254902,
      height: 0.030303030303030304,
      page: 1,
      source: 'text',
      coordinateSpace: 'normalized-page'
    },
    bboxes: [
      {
        x: 0.11764705882352941,
        y: 0.06915151515151516,
        width: 0.313843137254902,
        height: 0.030303030303030304,
        page: 1,
        source: 'text',
        coordinateSpace: 'normalized-page'
      }
    ]
  },
  rawAttributes: {
    Type: 'StructElem',
    S: 'ReportHeading',
    Pg: { ref: '3 0 R' },
    Lang: 'en-US'
  }
}

const expectedPageResult = {
  id: 'page-1',
  role: 'page',
  page: 1,
  pages: [1],
  text: 'Quarterly revenue',
  width: 612,
  height: 792
}

type MockQueryNode = {
  text: string
  toJSON(): Record<string, unknown>
}

async function run(argv: string[], overrides: Partial<PdfQueryCliIo> = {}) {
  let stdout = ''
  let stderr = ''
  const code = await runPdfQueryCli(argv, {
    ...overrides,
    stdout: (text) => { stdout += text },
    stderr: (text) => { stderr += text }
  })
  return { code, stdout, stderr }
}

async function runWithMockedDocument(
  argv: string[],
  results: MockQueryNode[],
  diagnostics: unknown[] = []
) {
  vi.resetModules()
  vi.doMock('@okrapdf/pdfdom/native', () => ({
    openTaggedPdf: vi.fn(async () => ({
      query: () => results,
      diagnostics
    }))
  }))

  try {
    const { runPdfQueryCli: runMockedCli } = await import('../cli.js')
    let stdout = ''
    let stderr = ''
    const code = await runMockedCli(argv, {
      readFile: async () => new Uint8Array([37, 80, 68, 70]),
      stdout: (text) => { stdout += text },
      stderr: (text) => { stderr += text }
    })
    return { code, stdout, stderr }
  } finally {
    vi.doUnmock('@okrapdf/pdfdom/native')
  }
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout)
}

describe('pdfquery CLI JSON contract', () => {
  it('emits multiple matches in document-query order', async () => {
    const result = await run([fixturePath, '*', '-o', 'json'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const payload = parseJson(result.stdout) as {
      selector: string
      count: number
      results: Array<{ id: string }>
      diagnostics: unknown[]
    }

    expect(payload.selector).toBe('*')
    expect(payload.count).toBe(3)
    expect(payload.diagnostics).toEqual([])
    expect(payload.results.map((node) => node.id)).toEqual([
      'page-1',
      'struct-7-0',
      'struct-6-0'
    ])
    expect(payload.results[2]).toEqual(expectedHeadingResult)
  })

  it('de-duplicates overlapping selector groups by node identity', async () => {
    const result = await run([fixturePath, 'H1,H1', '-o', 'json'])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(parseJson(result.stdout)).toEqual({
      selector: 'H1,H1',
      count: 1,
      results: [expectedHeadingResult],
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

describe('pdfquery CLI result-only JSON contracts', () => {
  const formats = ['json-array', 'jsonl'] as const

  it.each(formats)('%s emits every serialized match in document-query order', async (format) => {
    const result = await run([fixturePath, '*', '-o', format])

    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const matches = format === 'json-array'
      ? JSON.parse(result.stdout) as unknown[]
      : result.stdout.trimEnd().split('\n').map((line) => JSON.parse(line) as unknown)

    expect(matches).toHaveLength(3)
    expect(matches[0]).toEqual(expectedPageResult)
    expect(matches[2]).toEqual(expectedHeadingResult)
    expect(result.stdout).toBe(format === 'json-array'
      ? `${JSON.stringify(matches, null, 2)}\n`
      : `${matches.map((match) => JSON.stringify(match)).join('\n')}\n`)
  })

  it('defines exact successful empty output for both result-only modes', async () => {
    expect(await run([fixturePath, 'H6', '-o', 'json-array'])).toEqual({
      code: 0,
      stdout: '[]\n',
      stderr: ''
    })
    expect(await run([fixturePath, 'H6', '-o', 'jsonl'])).toEqual({
      code: 0,
      stdout: '',
      stderr: ''
    })
  })

  it.each(formats)('%s escapes multiline text and omits diagnostics', async (format) => {
    const serializedNode = {
      id: 'struct-multiline',
      role: 'P',
      text: 'Line one\nLine two'
    }
    const result = await runWithMockedDocument(
      ['fixture.pdf', 'P', '-o', format],
      [{ text: serializedNode.text, toJSON: () => serializedNode }],
      [{ level: 'warning', message: 'parser recovered a node' }]
    )

    expect(result).toEqual({
      code: 0,
      stdout: format === 'json-array'
        ? `${JSON.stringify([serializedNode], null, 2)}\n`
        : `${JSON.stringify(serializedNode)}\n`,
      stderr: ''
    })
    expect(result.stdout).toContain('Line one\\nLine two')
    expect(result.stdout).not.toContain('parser recovered a node')
    if (format === 'jsonl') expect(result.stdout.split('\n')).toHaveLength(2)
  })

  it.each(formats)('%s keeps operational errors on stderr and stdout empty', async (format) => {
    const result = await run(['fixture.pdf', 'H1', '-o', format], {
      readFile: async () => { throw new Error('fixture read failed') }
    })

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Error: fixture read failed\n'
    })
  })

  it('reports the complete output-format list for invalid values', async () => {
    expect(await run([fixturePath, 'H1', '-o', 'ndjson'])).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Error: unknown output format "ndjson"; expected text, json, json-array, jsonl, or size\n'
    })
  })

  it.each(formats)('rejects attributes combined with %s output', async (format) => {
    expect(await run([fixturePath, 'H1', '-a', 'role', '-o', format])).toEqual({
      code: 1,
      stdout: '',
      stderr: `Error: --attribute cannot be combined with --output ${format}\n`
    })
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
