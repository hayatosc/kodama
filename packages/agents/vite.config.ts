/**
 * Vite configuration of the local Worker (`nr dev:agents`).
 *
 * @module
 */
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [cloudflare({ experimental: { newConfig: { cfBuildOutput: true } } })],
})
