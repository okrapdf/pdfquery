import { defineConfig } from 'tsup'
import packageJson from './package.json' with { type: 'json' }

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  minify: true,
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  splitting: false,
  define: {
    PDFQUERY_VERSION: JSON.stringify(packageJson.version)
  }
})
