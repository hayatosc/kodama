/**
 * Vite configuration of the local Worker (`pnpm dev:agents`).
 *
 * @module
 */
import { cloudflare } from '@cloudflare/vite-plugin'
import reylo from 'reylo/vite'
import { defineConfig, lazyPlugins } from 'vite-plus'

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: lazyPlugins(() => [
    reylo(),
    cloudflare({ experimental: { newConfig: { cfBuildOutput: true } } }),
  ]),
})
