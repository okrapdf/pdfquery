import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      pdfquery: path.resolve(__dirname, '../src'),
    },
  },
  test: {
    include: ['__tests__/**/*.test.ts'],
    globals: true,
  },
});
