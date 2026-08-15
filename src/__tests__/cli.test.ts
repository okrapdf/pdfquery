import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { openTaggedPdf, type PdfStructureDocument } from '@okrapdf/pdfdom/native'
import { runPdfQueryCli, type PdfQueryCliIo } from '../cli.js'
import packageJson from '../../package.json' with { type: 'json' }

const fixturePath = fileURLToPath(new URL('../../fixtures/tagged-report.pdf', import.meta.url))
const multiFixturePath = fileURLToPath(new URL('../../fixtures/tagged-report-multi.pdf', import.meta.url))

async function run(argv: string[], io: Partial<PdfQueryCliIo> = {}) {
  let stdout = ''
  let stderr = ''
  const code = await runPdfQueryCli(argv, {
    stdout: (text) => { stdout += text },
    stderr: (text) => { stderr += text },
    ...io
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
    expect(await run(['--version'])).toEqual({ code: 0, stdout: `${packageJson.version}\n`, stderr: '' })
  })
})

describe('pdfquery JSON envelope contract', () => {
  it('emits the exact envelope keys for multiple matches in document order', async () => {
    const result = await run([multiFixturePath, 'Sect', '-o', 'json'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')

    const envelope = JSON.parse(result.stdout)
    expect(Object.keys(envelope)).toEqual(['selector', 'count', 'results', 'diagnostics'])
    expect(envelope.selector).toBe('Sect')
    expect(envelope.count).toBe(2)
    expect(envelope.diagnostics).toEqual([])
    expect(envelope.results.map((node: { id: string }) => node.id))
      .toEqual([...new Set(envelope.results.map((node: { id: string }) => node.id))])
    expect(envelope.results.map((node: { text: string }) => node.text)).toEqual([
      'Annual report Revenue increased in 2025. Notes line one\nNotes line two Nested bullet',
      'Quarterly results Metric 42 Chart placeholder'
    ])
  })

  it('returns exit 0 with count 0 and results [] for zero matches', async () => {
    const result = await run([multiFixturePath, 'H6', '-o', 'json'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      selector: 'H6',
      count: 0,
      results: [],
      diagnostics: []
    })
  })

  it('documents structure-node and virtual-page shapes with nullable fields', async () => {
    const structure = await run([multiFixturePath, 'Document', '-o', 'json'])
    const [documentNode] = JSON.parse(structure.stdout).results
    expect(documentNode).toMatchObject({
      role: 'Document',
      rawRole: 'Document',
      page: null,
      pages: [1, 2],
      bbox: null,
      language: 'en-US'
    })
    expect(documentNode).not.toHaveProperty('width')

    const pages = await run([multiFixturePath, 'page', '-o', 'json'])
    const pageResults = JSON.parse(pages.stdout).results
    expect(pageResults).toHaveLength(2)
    expect(pageResults[0]).toEqual({
      id: 'page-1',
      role: 'page',
      page: 1,
      pages: [1],
      text: 'Annual report\nRevenue increased in 2025.\nNotes line one\nNotes line two\nNested bullet',
      width: 612,
      height: 792
    })
  })

  it('keeps stdout valid JSON while surfacing diagnostics in the envelope', async () => {
    const diagnostic = { level: 'warning', page: 2, message: 'synthetic warning' }
    const result = await run([multiFixturePath, 'H1', '-o', 'json'], {
      openDocument: async (bytes) => {
        const document = await openTaggedPdf(bytes)
        return {
          root: document.root,
          pages: document.pages,
          pageCount: document.pageCount,
          diagnostics: [diagnostic],
          query: (selector: string) => document.query(selector),
          toJSON: () => document.toJSON()
        } as unknown as PdfStructureDocument
      }
    })
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const envelope = JSON.parse(result.stdout)
    expect(envelope.count).toBe(1)
    expect(envelope.diagnostics).toEqual([diagnostic])
  })

  it('jq projections read results and per-match text', async () => {
    const envelope = JSON.parse((await run([multiFixturePath, 'H1', '-o', 'json'])).stdout)
    expect(envelope.results).toHaveLength(1)
    expect(envelope.results.map((node: { text: string }) => node.text)).toEqual(['Annual report'])
  })
})

describe('pdfquery json-array and jsonl modes', () => {
  it('emits one top-level array for json-array', async () => {
    const result = await run([multiFixturePath, 'Sect', '-o', 'json-array'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const matches = JSON.parse(result.stdout)
    expect(Array.isArray(matches)).toBe(true)
    expect(matches).toHaveLength(2)
    expect(matches[1].children).toHaveLength(3)
  })

  it('emits []\\n for zero json-array matches and empty stdout for jsonl', async () => {
    expect(await run([multiFixturePath, 'H6', '-o', 'json-array'])).toEqual({
      code: 0,
      stdout: '[]\n',
      stderr: ''
    })
    expect(await run([multiFixturePath, 'H6', '-o', 'jsonl'])).toEqual({
      code: 0,
      stdout: '',
      stderr: ''
    })
  })

  it('emits one compact object per line for jsonl, including multiline text', async () => {
    const result = await run([multiFixturePath, 'Sect > P', '-o', 'jsonl'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    const lines = result.stdout.split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    const parsed = lines.map((line) => JSON.parse(line))
    expect(parsed[0].text).toBe('Revenue increased in 2025.')
    expect(parsed[1].text).toBe('Notes line one\nNotes line two')
    expect(result.stdout).not.toContain('Notes line one\nNotes')
  })

  it('serializes structure nodes and virtual pages in both machine modes', async () => {
    const arrayResult = await run([multiFixturePath, 'page[page=2] H2', '-o', 'json-array'])
    const [heading] = JSON.parse(arrayResult.stdout)
    expect(heading).toMatchObject({ role: 'H2', page: 2, text: 'Quarterly results' })

    const pageResult = await run([multiFixturePath, 'page', '-o', 'jsonl'])
    const pageLines = pageResult.stdout.split('\n').filter(Boolean)
    expect(pageLines).toHaveLength(2)
    expect(JSON.parse(pageLines[1])).toMatchObject({ id: 'page-2', role: 'page', page: 2 })
  })

  it('keeps progress and diagnostics out of machine-readable stdout', async () => {
    const result = await run([multiFixturePath, 'H1', '-o', 'jsonl'])
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ role: 'H1' })
  })

  it('rejects attribute output combined with machine modes', async () => {
    const result = await run([multiFixturePath, 'H1', '-a', 'role', '-o', 'jsonl'])
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Error: --attribute cannot be combined with --output json, json-array, jsonl, or size\n'
    })
  })
})

describe('pdfquery extraction maps', () => {
  it('evaluates scalar, array, field, and nested descriptors in one pass', async () => {
    const map = {
      title: 'H1',
      headings: ['H2'],
      figures: [{ selector: 'Figure', value: 'altText' }],
      sections: [
        {
          selector: 'Sect',
          value: {
            heading: ':is(H1, H2)',
            paragraphs: ['Sect > P, L P']
          }
        }
      ],
      missing: 'H6',
      empty: ['H6']
    }
    const result = await run([multiFixturePath, '-e', JSON.stringify(map)])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({
      title: 'Annual report',
      headings: ['Quarterly results'],
      figures: ['Quarterly revenue chart'],
      sections: [
        {
          heading: 'Annual report',
          paragraphs: [
            'Revenue increased in 2025.',
            'Notes line one\nNotes line two',
            'Nested bullet'
          ]
        },
        { heading: 'Quarterly results', paragraphs: [] }
      ],
      missing: null,
      empty: []
    })
    expect(Object.keys(JSON.parse(result.stdout))).toEqual([
      'title',
      'headings',
      'figures',
      'sections',
      'missing',
      'empty'
    ])
  })

  it('reads maps from files and stdin without shell quoting', async () => {
    const map = JSON.stringify({ title: 'H1', cell: { selector: 'TD', value: 'text' } })
    const mapPath = '/virtual/map.json'
    const realRead = (path: string) => readFile(path)
    const fromFile = await run([multiFixturePath, '--extract-file', mapPath], {
      readFile: async (path) => path === mapPath
        ? new TextEncoder().encode(map)
        : new Uint8Array(await realRead(path))
    })
    expect(fromFile.code).toBe(0)
    expect(JSON.parse(fromFile.stdout)).toEqual({ title: 'Annual report', cell: '42' })

    const fromStdin = await run([multiFixturePath, '-E', '-'], {
      readStdin: async () => new TextEncoder().encode(map)
    })
    expect(fromStdin.code).toBe(0)
    expect(JSON.parse(fromStdin.stdout)).toEqual({ title: 'Annual report', cell: '42' })
  })

  it('supports page-scoped selectors at the top level', async () => {
    const result = await run([multiFixturePath, '-e', '{"heading":"page[page=2] H2"}'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ heading: 'Quarterly results' })
  })

  it('reports selector-path errors with exit 1 and clean stdout', async () => {
    const badSyntax = await run([multiFixturePath, '-e', '{"sections":[{"selector":"Sect","value":{"heading":"H2 >"}}]}'])
    expect(badSyntax.code).toBe(1)
    expect(badSyntax.stdout).toBe('')
    expect(badSyntax.stderr).toContain('sections[0].value.heading:')
    expect(badSyntax.stderr).toMatch(/^Error: /)

    const badField = await run([multiFixturePath, '-e', '{"fig":{"selector":"Figure","value":"nope"}}'])
    expect(badField.code).toBe(1)
    expect(badField.stderr).toContain('fig.value')
    expect(badField.stderr).toContain('unknown serialized field')

    const badJson = await run([multiFixturePath, '-e', '{title'])
    expect(badJson.code).toBe(1)
    expect(badJson.stderr).toContain('invalid JSON')

    const badDescriptor = await run([multiFixturePath, '-e', '{"title":42}'])
    expect(badDescriptor.code).toBe(1)
    expect(badDescriptor.stderr).toContain('title')

    const nestedArray = await run([multiFixturePath, '-e', '{"title":[["H1"]]}'])
    expect(nestedArray.code).toBe(1)
    expect(nestedArray.stderr).toContain('array descriptors cannot nest')
  })

  it('rejects combinations with selector, attribute, and output flags', async () => {
    const withSelector = await run([multiFixturePath, 'H1', '-e', '{}'])
    expect(withSelector).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Error: --extract cannot be combined with a positional selector\n'
    })
    const withOutput = await run([multiFixturePath, '-e', '{}', '-o', 'json'])
    expect(withOutput.code).toBe(1)
    expect(withOutput.stderr).toBe('Error: --extract cannot be combined with --output\n')
    const withAttribute = await run([multiFixturePath, '-e', '{}', '-a', 'role'])
    expect(withAttribute.code).toBe(1)
    expect(withAttribute.stderr).toBe('Error: --extract cannot be combined with --attribute\n')
    const bothStdin = await run(['-', '-E', '-'])
    expect(bothStdin.code).toBe(1)
    expect(bothStdin.stderr).toBe('Error: stdin cannot supply both the PDF and the extraction map\n')
  })
})
