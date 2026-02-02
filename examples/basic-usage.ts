import { pdfquery, type Tag } from 'pdfquery';

/**
 * Basic usage example for pdfquery
 *
 * Feed Tags in, query with $. No compiler needed.
 */
function main() {
  // 1. Define tags (the canonical input format)
  const tags: Tag[] = [
    {
      id: 'table_1',
      type: 'table',
      page: 1,
      bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
      text: '| Quarter | Revenue | Profit |\n|---|---|---|\n| Q1 | $100M | $20M |\n| Q2 | $120M | $25M |',
      attrs: { confidence: 0.95 },
    },
    {
      id: 'currency_1',
      type: 'currency',
      page: 1,
      bbox: { x: 0.5, y: 0.35, width: 0.1, height: 0.02 },
      text: '$120M',
      attrs: { confidence: 0.98, value: 120000000 },
    },
  ];

  // 2. Create session
  const session = pdfquery.ready({ tags });

  // 3. Query the document
  const $$ = session.$;

  console.log('--- Selection by Type ---');
  console.log('Tables found:', $$('.table').count());
  console.log('Currency elements:', $$('.currency').count());

  console.log('\n--- Filtering by Attributes ---');
  const highConfidence = $$('[confidence>0.9]');
  console.log('High confidence elements:', highConfidence.count());

  console.log('\n--- Text Search ---');
  const revenueNodes = $$(':contains("Revenue")');
  console.log('Nodes containing "Revenue":', revenueNodes.count());

  console.log('\n--- Chaining & Aggregation ---');
  const tableTexts = $$('.table').onPage(1).texts();
  console.log('Table 1 content preview:', tableTexts[0]?.substring(0, 50) + '...');

  const avgConfidence = $$('*').stats().avgConfidence;
  console.log('Average document confidence:', (avgConfidence * 100).toFixed(1) + '%');
}

main();
