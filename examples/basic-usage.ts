import { createQueryEngine, DocCompiler } from 'pdfquery';

/**
 * Basic usage example for pdfQuery
 */
function main() {
  // 1. Mock extracted data (usually from an OCR/Extraction API)
  const mockTables = [
    {
      id: 'table_1',
      page_number: 1,
      content_markdown: '| Quarter | Revenue | Profit |\n|---|---|---|
| Q1 | $100M | $20M |\n| Q2 | $120M | $25M |',
      bbox: { xmin: 0.1, ymin: 0.1, xmax: 0.9, ymax: 0.4 },
      confidence: 0.95,
      verification_status: 'verified',
    }
  ];

  const mockEntities = [
    {
      id: 'entity_1',
      type: 'currency',
      text: '$120M',
      page: 1,
      bbox: { xmin: 0.5, ymin: 0.35, xmax: 0.6, ymax: 0.37 },
      confidence: 0.98,
      attributes: { currency: 'USD', value: 120000000 }
    }
  ];

  // 2. Compile into a Virtual Document
  const compiler = new DocCompiler({ documentId: 'demo-doc' });
  compiler.addTables(mockTables);
  compiler.addEntities(mockEntities);
  
  const doc = compiler.compile();

  // 3. Create the query engine ($$)
  const $$ = createQueryEngine(doc);

  // 4. Query the document
  console.log('--- Selection by Type ---');
  console.log('Tables found:', $$('.table').length);
  console.log('Currency elements:', $$('.currency').length);

  console.log('\n--- Filtering by Attributes ---');
  const highConfidence = $$('[confidence>0.9]');
  console.log('High confidence elements:', highConfidence.length);

  console.log('\n--- Text Search ---');
  const revenueNodes = $$(':contains("Revenue")');
  console.log('Nodes containing "Revenue":', revenueNodes.length);

  console.log('\n--- Chaining & Aggregation ---');
  const tableTexts = $$('.table').onPage(1).texts();
  console.log('Table 1 content preview:', tableTexts[0].substring(0, 50) + '...');

  const avgConfidence = $$('*').stats().avgConfidence;
  console.log('Average document confidence:', (avgConfidence * 100).toFixed(1) + '%');
}

main();
