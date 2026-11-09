/** Format Svelte sources with the workspace's shared Vite+ formatting settings. @module */
import { execFileSync } from 'node:child_process'
import { globSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import config from '../vite.config.ts'

// rsvelte-fmt reads JSON configuration, not vite.config.ts.
const directory = mkdtempSync(join(tmpdir(), 'kodama-format-svelte-'))
try {
  const configPath = join(directory, 'oxfmt.json')
  writeFileSync(configPath, JSON.stringify(config.fmt))
  execFileSync(
    'rsvelte-fmt',
    [
      '--config',
      configPath,
      ...process.argv.slice(2),
      ...globSync('packages/ui/**/*.svelte', {
        exclude: ['**/node_modules/**', '**/.svelte-kit/**', '**/storybook-static/**'],
      }),
    ],
    { stdio: 'inherit' },
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}
