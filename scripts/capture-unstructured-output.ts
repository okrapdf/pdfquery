import { readFileSync, writeFileSync } from 'fs';
import { UnstructuredClient } from 'unstructured-client';
import { Strategy } from 'unstructured-client/sdk/models/shared';

const API_KEY = process.env.UNSTRUCTURED_API_KEY;
if (!API_KEY) {
  console.error('UNSTRUCTURED_API_KEY env var required');
  process.exit(1);
}

const client = new UnstructuredClient({
  security: { apiKeyAuth: API_KEY },
});

async function main() {
  const pdfPath = 'src/adapters/__tests__/fixtures/layout-parser-paper-fast.pdf';
  const outputPath = 'src/adapters/__tests__/fixtures/unstructured-real-output.json';

  console.log(`Reading ${pdfPath}...`);
  const fileContent = readFileSync(pdfPath);

  console.log('Calling Unstructured API with coordinates=true...');
  const response = await client.general.partition({
    partitionParameters: {
      files: {
        content: fileContent,
        fileName: 'layout-parser-paper-fast.pdf',
      },
      strategy: Strategy.Fast,
      coordinates: true,
    },
  });

  console.log(`Got ${response.length} elements`);
  writeFileSync(outputPath, JSON.stringify(response, null, 2));
  console.log(`Saved to ${outputPath}`);

  if (response.length > 0) {
    console.log('\nSample element:');
    console.log(JSON.stringify(response[0], null, 2));
  }
}

main().catch(console.error);
