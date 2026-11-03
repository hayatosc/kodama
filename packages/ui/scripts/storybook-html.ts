/**
 * Turns the single-file Storybook preview (`STORYBOOK_SINGLE_FILE=1 storybook build`) into one
 * self-contained HTML page. CI uploads that page as an unzipped artifact, so a pull request's
 * Storybook opens straight in the browser.
 *
 * The page is Storybook's own preview (`iframe.html`) with three additions: the story index
 * embedded in place of the `index.json` request, Storybook's static assets inlined as data URLs,
 * and a sidebar (`storybook-html-runtime.ts`) standing in for the Storybook manager.
 *
 * Usage: `node --experimental-strip-types scripts/storybook-html.ts <build dir> <output file>`
 *
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** What `toSingleHtml` needs from a single-file Storybook build. */
export type SingleHtmlInput = {
  /** The built `iframe.html`, with its scripts and styles already inlined. */
  html: string
  /** The built `index.json`. */
  index: string
  /** The sidebar runtime, already compiled to JavaScript. */
  runtime: string
  /** One line naming what the page was built from, such as a commit; omitted when undefined. */
  buildInfo?: string
  /** Reads a build file referenced as `./sb-common-assets/<name>`. */
  readAsset: (name: string) => Uint8Array
}

/** Media types for the assets Storybook references from its preview. */
const MEDIA_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

/** Storybook's shared assets, referenced relative to the build folder. */
const COMMON_ASSET = /\.\/sb-common-assets\/([\w.-]+)/g

/** Relative references that would break once the page is served on its own. */
const RELATIVE_REFERENCE = /(?:src|href)="\.\/[^"]*"|from\s*"\.\/[^"]*"|url\(\s*['"]?\.\/[^)]*\)/g

/** JSON safe to place inside a `<script>` element: `<` cannot close the element. */
function scriptJson(text: string): string {
  return text.replaceAll('<', '\\u003c')
}

/** A file's bytes as a `data:` URL. */
function dataUrl(name: string, bytes: Uint8Array): string {
  const mediaType = MEDIA_TYPES[extname(name)]
  if (mediaType === undefined) throw new TypeError(`No media type for Storybook asset ${name}`)
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`
}

/**
 * Builds the single-file page from a single-file Storybook build.
 *
 * @throws {@link TypeError} When the page still references a file next to it, which would not
 * load once the page is served on its own, or when the runtime would close its `<script>`.
 */
export function toSingleHtml(input: SingleHtmlInput): string {
  const head = /<head[^>]*>/.exec(input.html)
  if (head === null) throw new TypeError('The Storybook preview has no <head>')
  if (/<\/script/i.test(input.runtime)) throw new TypeError('The runtime cannot contain </script>')

  const injected = [
    `<script id="kodama-story-index" type="application/json">${scriptJson(input.index)}</script>`,
    input.buildInfo === undefined
      ? ''
      : `<script id="kodama-build-info" type="application/json">${scriptJson(input.buildInfo)}</script>`,
    `<script>${input.runtime}</script>`,
  ].join('')
  const end = head.index + head[0].length
  const html = (input.html.slice(0, end) + injected + input.html.slice(end))
    .replace(/<link rel="modulepreload"[^>]*href="\.\/[^"]*"[^>]*>/g, '')
    .replace(COMMON_ASSET, (_, name: string) => dataUrl(name, input.readAsset(name)))
    .replace(/<title>[^<]*<\/title>/, '<title>Kodama UI · Storybook</title>')

  const leftovers = html.match(RELATIVE_REFERENCE)
  if (leftovers !== null) {
    throw new TypeError(
      `The page still references local files: ${[...new Set(leftovers)].join(', ')}`,
    )
  }
  return html
}

/** The build line shown in the sidebar, from CI's environment when it is there. */
function buildInfoFromEnv(): string | undefined {
  const commit = process.env.KODAMA_BUILD_COMMIT
  if (commit === undefined || commit === '') return undefined
  const ref = process.env.KODAMA_BUILD_REF
  return `Built from ${commit.slice(0, 8)}${ref ? ` on ${ref}` : ''}`
}

/** Reads the build, writes the page, and reports its size. */
async function main(buildDir: string, output: string): Promise<void> {
  const runtimeSource = await readFile(
    fileURLToPath(new URL('./storybook-html-runtime.ts', import.meta.url)),
    'utf8',
  )
  const commonAssets = join(buildDir, 'sb-common-assets')
  const assets = new Map<string, Uint8Array>()
  const html = await readFile(join(buildDir, 'iframe.html'), 'utf8')
  for (const [, name] of html.matchAll(COMMON_ASSET)) {
    if (name !== undefined) assets.set(name, await readFile(join(commonAssets, name)))
  }

  const page = toSingleHtml({
    html,
    index: await readFile(join(buildDir, 'index.json'), 'utf8'),
    runtime: stripTypeScriptTypes(runtimeSource),
    buildInfo: buildInfoFromEnv(),
    readAsset: (name) => {
      const bytes = assets.get(name)
      if (bytes === undefined) throw new TypeError(`Missing Storybook asset ${name}`)
      return bytes
    },
  })
  await writeFile(output, page)
  console.log(`Wrote ${output} (${(Buffer.byteLength(page) / 1024 / 1024).toFixed(1)} MB)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [buildDir = 'storybook-single', output = 'storybook.html'] = process.argv.slice(2)
  await main(buildDir, output)
}
