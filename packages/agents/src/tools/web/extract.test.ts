/** Pinned-workerd charset decoding and inert document extraction fixtures. @module */
import { expect, it } from 'vitest'
import { decodeDocument, extractHtml } from './extract.ts'

it.each([
  { charset: 'utf-8', bytes: [0xc3, 0xa9], text: 'é' },
  { charset: 'utf8', bytes: [0xc3, 0xa9], text: 'é' },
  { charset: 'utf-16le', bytes: [0xe9, 0], text: 'é' },
  { charset: 'utf-16be', bytes: [0, 0xe9], text: 'é' },
  { charset: 'windows-1252', bytes: [0x80], text: '€' },
  { charset: 'iso-8859-1', bytes: [0xe9], text: 'é' },
  { charset: 'shift_jis', bytes: [0x82, 0xa0], text: 'あ' },
])('decodes the allowlisted $charset on workerd', ({ charset, bytes, text }) => {
  expect(decodeDocument(new Uint8Array(bytes), `text/plain;charset=${charset}`, false)).toEqual({
    decoded: text,
    charset,
  })
})

it('prioritizes BOM over HTTP over initial meta and fails unsupported or malformed encodings', () => {
  expect(
    decodeDocument(new Uint8Array([0xff, 0xfe, 0x41, 0]), 'text/html;charset=shift_jis', true),
  ).toEqual({ decoded: 'A', charset: 'utf-16le' })
  const meta = new TextEncoder().encode('<meta charset="windows-1252"><body>text</body>')
  expect(decodeDocument(meta, 'text/html', true).charset).toBe('windows-1252')
  expect(decodeDocument(meta, 'text/html;charset=utf-8', true).charset).toBe('utf-8')
  expect(() => decodeDocument(meta, 'text/plain;charset=utf-32', false)).toThrow(
    'unsupported_charset',
  )
  expect(() => decodeDocument(new Uint8Array([0xc3]), 'text/plain', false)).toThrow(
    'invalid_encoding',
  )
  expect(() =>
    decodeDocument(new Uint8Array(800_000).fill(0x80), 'text/plain;charset=windows-1252', false),
  ).toThrow('response_too_large')
})

it('prefers main then body, preserves blocks and distinguishes inert empty HTML', async () => {
  const signal = new AbortController().signal
  expect(
    (
      await extractHtml(
        '<body>Body<main><h1>Heading</h1><p>Paragraph</p><pre>Code</pre></main></body>',
        1000,
        signal,
      )
    ).text,
  ).toBe('Heading\nParagraph\nCode')
  expect(
    (
      await extractHtml(
        '<body>Body<script>attack</script><p aria-hidden="true">secret</p></body>',
        1000,
        signal,
      )
    ).text,
  ).toBe('Body')
  await expect(extractHtml('<body><script>attack</script></body>', 1000, signal)).rejects.toThrow(
    'empty_extraction',
  )
})
