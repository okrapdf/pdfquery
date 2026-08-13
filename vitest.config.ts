import { configDefaults, defineConfig } from 'vitest/config'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  define: {
    PDFQUERY_VERSION: JSON.stringify(packageJson.version)
  },
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, '**/.benchmark-baseline/**']
  }
})
