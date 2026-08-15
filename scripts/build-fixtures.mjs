import { writeFile } from 'node:fs/promises'
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  StandardFonts
} from 'pdf-lib'

const FIXED_DATE = new Date('2024-01-01T00:00:00.000Z')

function beginMarkedContent(role, mcid) {
  return PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
    PDFName.of(role),
    `<< /MCID ${mcid} >>`
  ])
}

const endMarkedContent = () => PDFOperator.of(PDFOperatorNames.EndMarkedContent)

/** Build the deterministic multi-page tagged fixture used by CLI contract tests. */
export async function createMultiPageTaggedPdf() {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.setTitle('pdfquery multi-page tagged fixture')
  pdf.setAuthor('pdfquery tests')
  pdf.setCreator('pdfquery tests')
  pdf.setProducer('pdf-lib')
  pdf.setCreationDate(FIXED_DATE)
  pdf.setModificationDate(FIXED_DATE)
  pdf.setLanguage('en-US')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pageOne = pdf.addPage([612, 792])
  const pageTwo = pdf.addPage([612, 792])

  pageOne.pushOperators(beginMarkedContent('ReportHeading', 0))
  pageOne.drawText('Annual report', { x: 72, y: 720, size: 24, font })
  pageOne.pushOperators(endMarkedContent())

  pageOne.pushOperators(beginMarkedContent('P', 1))
  pageOne.drawText('Revenue increased in 2025.', { x: 72, y: 680, size: 12, font })
  pageOne.pushOperators(endMarkedContent())

  pageOne.pushOperators(beginMarkedContent('P', 2))
  pageOne.drawText('Notes line one\nNotes line two', { x: 72, y: 640, size: 12, font, lineHeight: 14 })
  pageOne.pushOperators(endMarkedContent())

  pageOne.pushOperators(beginMarkedContent('P', 3))
  pageOne.drawText('Nested bullet', { x: 96, y: 590, size: 12, font })
  pageOne.pushOperators(endMarkedContent())

  pageTwo.pushOperators(beginMarkedContent('H2', 0))
  pageTwo.drawText('Quarterly results', { x: 72, y: 720, size: 18, font })
  pageTwo.pushOperators(endMarkedContent())

  pageTwo.pushOperators(beginMarkedContent('TH', 1))
  pageTwo.drawText('Metric', { x: 72, y: 680, size: 12, font })
  pageTwo.pushOperators(endMarkedContent())

  pageTwo.pushOperators(beginMarkedContent('TD', 2))
  pageTwo.drawText('42', { x: 200, y: 680, size: 12, font })
  pageTwo.pushOperators(endMarkedContent())

  pageTwo.pushOperators(beginMarkedContent('Figure', 3))
  pageTwo.drawText('Chart placeholder', { x: 72, y: 620, size: 12, font })
  pageTwo.pushOperators(endMarkedContent())

  pageOne.node.set(PDFName.of('StructParents'), PDFNumber.of(0))
  pageOne.node.set(PDFName.of('Tabs'), PDFName.of('S'))
  pageTwo.node.set(PDFName.of('StructParents'), PDFNumber.of(1))
  pageTwo.node.set(PDFName.of('Tabs'), PDFName.of('S'))

  const { context, catalog } = pdf
  const structureRoot = context.obj({ Type: 'StructTreeRoot' })
  const structureRootRef = context.register(structureRoot)

  const documentElement = context.obj({
    Type: 'StructElem',
    S: 'Document',
    P: structureRootRef,
    Lang: PDFString.of('en-US')
  })
  const documentRef = context.register(documentElement)

  const sectionOne = context.obj({ Type: 'StructElem', S: 'Sect', P: documentRef })
  const sectionOneRef = context.register(sectionOne)

  const heading = context.obj({
    Type: 'StructElem',
    S: 'ReportHeading',
    P: sectionOneRef,
    Pg: pageOne.ref,
    K: { Type: 'MCR', Pg: pageOne.ref, MCID: 0 },
    Lang: PDFString.of('en-US')
  })
  const headingRef = context.register(heading)

  const paragraphOne = context.obj({
    Type: 'StructElem',
    S: 'P',
    P: sectionOneRef,
    Pg: pageOne.ref,
    K: 1,
    Lang: PDFString.of('en-US')
  })
  const paragraphOneRef = context.register(paragraphOne)

  const paragraphTwo = context.obj({
    Type: 'StructElem',
    S: 'P',
    P: sectionOneRef,
    Pg: pageOne.ref,
    K: 2
  })
  const paragraphTwoRef = context.register(paragraphTwo)

  const listParagraph = context.obj({
    Type: 'StructElem',
    S: 'P',
    P: undefined,
    Pg: pageOne.ref,
    K: 3
  })
  listParagraph.delete(PDFName.of('P'))
  const listParagraphRef = context.register(listParagraph)
  const listBody = context.obj({ Type: 'StructElem', S: 'LBody', K: [listParagraphRef] })
  const listBodyRef = context.register(listBody)
  listParagraph.set(PDFName.of('P'), listBodyRef)
  const listItem = context.obj({ Type: 'StructElem', S: 'LI', K: [listBodyRef] })
  const listItemRef = context.register(listItem)
  listBody.set(PDFName.of('P'), listItemRef)
  const list = context.obj({ Type: 'StructElem', S: 'L', K: [listItemRef] })
  const listRef = context.register(list)
  listItem.set(PDFName.of('P'), listRef)
  list.set(PDFName.of('P'), sectionOneRef)

  const sectionTwo = context.obj({ Type: 'StructElem', S: 'Sect', P: documentRef })
  const sectionTwoRef = context.register(sectionTwo)

  const headingTwo = context.obj({
    Type: 'StructElem',
    S: 'H2',
    P: sectionTwoRef,
    Pg: pageTwo.ref,
    K: 0,
    Lang: PDFString.of('en-US')
  })
  const headingTwoRef = context.register(headingTwo)

  const headerCell = context.obj({
    Type: 'StructElem',
    S: 'TH',
    P: undefined,
    Pg: pageTwo.ref,
    K: 1
  })
  headerCell.delete(PDFName.of('P'))
  const headerCellRef = context.register(headerCell)
  const dataCell = context.obj({
    Type: 'StructElem',
    S: 'TD',
    P: undefined,
    Pg: pageTwo.ref,
    K: 2
  })
  dataCell.delete(PDFName.of('P'))
  const dataCellRef = context.register(dataCell)
  const row = context.obj({ Type: 'StructElem', S: 'TR', K: [headerCellRef, dataCellRef] })
  const rowRef = context.register(row)
  headerCell.set(PDFName.of('P'), rowRef)
  dataCell.set(PDFName.of('P'), rowRef)
  const table = context.obj({ Type: 'StructElem', S: 'Table', K: [rowRef] })
  const tableRef = context.register(table)
  row.set(PDFName.of('P'), tableRef)
  table.set(PDFName.of('P'), sectionTwoRef)

  const figure = context.obj({
    Type: 'StructElem',
    S: 'Figure',
    P: sectionTwoRef,
    Pg: pageTwo.ref,
    K: 3,
    Alt: PDFHexString.fromText('Quarterly revenue chart'),
    A: { O: 'Layout', BBox: [72, 600, 360, 660] }
  })
  const figureRef = context.register(figure)

  documentElement.set(PDFName.of('K'), context.obj([sectionOneRef, sectionTwoRef]))
  sectionOne.set(
    PDFName.of('K'),
    context.obj([headingRef, paragraphOneRef, paragraphTwoRef, listRef])
  )
  sectionTwo.set(PDFName.of('K'), context.obj([headingTwoRef, tableRef, figureRef]))

  const parentTree = context.obj({
    Nums: [
      0,
      [headingRef, paragraphOneRef, paragraphTwoRef, listParagraphRef],
      1,
      [headingTwoRef, headerCellRef, dataCellRef, figureRef]
    ]
  })
  const parentTreeRef = context.register(parentTree)

  structureRoot.set(PDFName.of('K'), documentRef)
  structureRoot.set(PDFName.of('ParentTree'), parentTreeRef)
  structureRoot.set(PDFName.of('ParentTreeNextKey'), PDFNumber.of(2))
  structureRoot.set(PDFName.of('RoleMap'), context.obj({ ReportHeading: 'H1' }))

  catalog.set(PDFName.of('StructTreeRoot'), structureRootRef)
  catalog.set(PDFName.of('MarkInfo'), context.obj({ Marked: true }))

  return pdf.save({
    addDefaultPage: false,
    updateFieldAppearances: false,
    useObjectStreams: false
  })
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const bytes = await createMultiPageTaggedPdf()
  const target = new URL('../fixtures/tagged-report-multi.pdf', import.meta.url)
  await writeFile(target, bytes)
  console.log(`wrote ${target.pathname} (${bytes.byteLength} bytes)`)
}
