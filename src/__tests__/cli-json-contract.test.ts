import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { runPdfQueryCli, type PdfQueryCliIo } from '../cli.js'
import { openTaggedPdf } from '../native.js'

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
  vi.doMock('../native.js', () => ({
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
    vi.doUnmock('../native.js')
  }
}

function parseJson(stdout: string): unknown {
  return JSON.parse(stdout)
}

function taggedPdfWithExpandedText(): Uint8Array {
  const content = '/H1 <</MCID 0>> BDC\nBT /F1 24 Tf 72 720 Td (Expanded body) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 7 0 R /MarkInfo << /Marked true >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /StructParents 0 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /StructElem /S /H1 /P 7 0 R /Pg 3 0 R /K 0 /E (Expanded label) >>',
    '<< /Type /StructTreeRoot /K [6 0 R] /ParentTree 8 0 R /ParentTreeNextKey 1 >>',
    '<< /Nums [0 [6 0 R]] >>'
  ]
  const encoder = new TextEncoder()
  let pdf = '%PDF-1.7\n%1234\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(encoder.encode(pdf).byteLength)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = encoder.encode(pdf).byteLength
  pdf += 'xref\n0 9\n0000000000 65535 f \n'
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encoder.encode(pdf)
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
    expect(payload.results[1]).toMatchObject({
      id: 'struct-7-0',
      parent: null
    })
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

describe('pdfquery live attribute contract', () => {
  it('sends the handle table only for the first successful native query', async () => {
    const require = createRequire(import.meta.url)
    const native = require(fileURLToPath(
      new URL('../../dist/native/pdfquery_native.cjs', import.meta.url)
    )) as {
      NativeDocument: new (bytes: Uint8Array) => {
        queryJson(selector: string, includeHandles: boolean): string
        free(): void
      }
    }
    const document = new native.NativeDocument(
      new Uint8Array(await readFile(fixturePath))
    )

    try {
      const first = JSON.parse(document.queryJson('H1', true)) as {
        resultIds: string[]
        handles?: unknown[]
      }
      const repeated = JSON.parse(document.queryJson('H1', false)) as {
        resultIds: string[]
        handles?: unknown[]
      }

      expect(first.resultIds).toEqual(['struct-6-0'])
      expect(first.handles).toHaveLength(3)
      expect(repeated.resultIds).toEqual(first.resultIds)
      expect(repeated).not.toHaveProperty('handles')
      expect(JSON.stringify(repeated).length).toBeLessThan(JSON.stringify(first).length / 4)
    } finally {
      document.free()
    }
  })

  it('keeps relationship properties as stable handles while toJSON uses IDs', async () => {
    const document = await openTaggedPdf(new Uint8Array(await readFile(fixturePath)))
    const root = document.query('Root')[0] as Record<string, unknown> & { toJSON(): unknown }
    const heading = document.query('H1')[0] as Record<string, unknown> & { toJSON(): unknown }

    expect(heading.parent).toBe(root)
    expect((root.children as unknown[])[0]).toBe(heading)
    expect(document.query('H1')[0]).toBe(heading)
    expect(heading.toJSON()).toMatchObject({ parent: 'struct-7-0', children: [] })
    expect(root.toJSON()).toMatchObject({ parent: null, children: ['struct-6-0'] })
  })

  it('hydrates after an invalid first selector without losing stable identity', async () => {
    const document = await openTaggedPdf(new Uint8Array(await readFile(fixturePath)))

    expect(() => document.query('H1[')).toThrow('Unterminated attribute selector')
    const heading = document.query('H1')[0]
    expect(document.query('H1')[0]).toBe(heading)
  })

  it('serializes parent and children attributes as their node snapshots', async () => {
    const all = parseJson((await run([fixturePath, '*', '-o', 'json-array'])).stdout) as Array<{
      id: string
    }>
    const root = all.find((node) => node.id === 'struct-7-0')
    const heading = all.find((node) => node.id === 'struct-6-0')

    expect(await run([fixturePath, 'H1', '-a', 'parent'])).toEqual({
      code: 0,
      stdout: `${JSON.stringify(root)}\n`,
      stderr: ''
    })
    expect(await run([fixturePath, 'Root', '-a', 'children'])).toEqual({
      code: 0,
      stdout: `${JSON.stringify([heading])}\n`,
      stderr: ''
    })
  })

  it('preserves virtual page live-only fields', async () => {
    expect(await run([fixturePath, 'page', '-a', 'pageNumber'])).toEqual({
      code: 0,
      stdout: '1\n',
      stderr: ''
    })
    expect(await run([fixturePath, 'page', '-a', 'ownText'])).toEqual({
      code: 0,
      stdout: 'Quarterly revenue\n',
      stderr: ''
    })
    expect(await run([fixturePath, 'page', '-a', 'rawAttributes'])).toEqual({
      code: 0,
      stdout: '{"page":1,"pageNumber":1,"width":612,"height":792}\n',
      stderr: ''
    })
    expect(await run([fixturePath, 'page', '-a', 'children'])).toEqual({
      code: 0,
      stdout: '[]\n',
      stderr: ''
    })
  })

  it('exposes expandedText without adding it to the JSON snapshot', async () => {
    const bytes = taggedPdfWithExpandedText()
    const readExpandedFixture = { readFile: async () => bytes }

    expect(await run(['expanded.pdf', 'H1', '-a', 'expandedText'], readExpandedFixture)).toEqual({
      code: 0,
      stdout: 'Expanded label\n',
      stderr: ''
    })
    const json = await run(['expanded.pdf', 'H1', '-o', 'json-array'], readExpandedFixture)
    expect(json.code).toBe(0)
    expect((parseJson(json.stdout) as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'expandedText'
    )
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
    vi.doMock('../native.js', () => ({
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

    vi.doUnmock('../native.js')
  })
})
