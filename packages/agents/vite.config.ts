/**
 * Vite configuration of the local Worker (`vp run dev:agents`).
 *
 * @module
 */
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig, lazyPlugins } from 'vite-plus'

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: lazyPlugins(() => [
    cloudflare({ experimental: { newConfig: { cfBuildOutput: true } } }),
  ]),
})
