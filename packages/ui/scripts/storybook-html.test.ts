/**
 * Tests for turning the single-file Storybook build into one HTML page.
 *
 * @module
 */

import { describe, expect, test } from 'vitest'
import { toSingleHtml, type SingleHtmlInput } from './storybook-html.ts'

/** A minimal single-file build: inlined code plus the references Storybook leaves behind. */
function input(overrides: Partial<SingleHtmlInput> = {}): SingleHtmlInput {
  return {
    html: [
      '<!doctype html><html><head><title>Storybook</title>',
      '<link rel="modulepreload" crossorigin href="./preload-helper-abc.js">',
      '<style>@font-face{src:url(./sb-common-assets/nunito-sans-regular.woff2)}</style>',
      '</head><body><div id="storybook-root"></div><script type="module">boot()</script></body></html>',
    ].join(''),
    index: '{"v":5,"entries":{"a--b":{"id":"a--b","title":"A","name":"B","type":"story"}}}',
    runtime: 'start()',
    readAsset: () => new Uint8Array([1, 2, 3]),
    ...overrides,
  }
}

describe('toSingleHtml', () => {
  test('embeds the index, the build line, and the runtime before Storybook runs', () => {
    const html = toSingleHtml(input({ buildInfo: 'Built from 1234abcd' }))
    const head = html.indexOf('<head>') + '<head>'.length
    expect(html.indexOf('id="kodama-story-index"')).toBeGreaterThanOrEqual(head)
    expect(html.indexOf('<script>start()</script>')).toBeLessThan(html.indexOf('boot()'))
    expect(html).toContain('"Built from 1234abcd"'.slice(1, -1))
    expect(html).toContain('<title>Kodama UI · Storybook</title>')
  })

  test('leaves no reference to files next to the page', () => {
    const html = toSingleHtml(input())
    expect(html).not.toContain('./preload-helper')
    expect(html).toContain('url(data:font/woff2;base64,AQID)')
  })

  test('keeps the embedded index from closing its script element', () => {
    const html = toSingleHtml(input({ index: '{"name":"</script><script>alert(1)"}' }))
    expect(html).toContain('{"name":"\\u003c/script>\\u003cscript>alert(1)"}')
  })

  test('refuses a page that still loads a local file', () => {
    const html = input().html.replace('</head>', '<script src="./chunk.js"></script></head>')
    expect(() => toSingleHtml(input({ html }))).toThrow(/\.\/chunk\.js/)
  })

  test('refuses a runtime that would close its own script element', () => {
    expect(() => toSingleHtml(input({ runtime: 'x = "</script>"' }))).toThrow(TypeError)
  })
})
