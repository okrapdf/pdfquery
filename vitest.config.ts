import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  define: {
    PDFQUERY_VERSION: JSON.stringify(packageJson.version)
  },
  resolve: {
    alias: {
      '@okrapdf/pdfdom/native': fileURLToPath(new URL('../pdfdom/src/native.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node'
  }
})
