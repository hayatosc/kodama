/** Decode bounded web documents and extract inert article/main/body text with HTMLRewriter. @module */
import { limitText } from './url.ts'

const encodings = new Set([
  'utf-8',
  'utf8',
  'utf-16le',
  'utf-16be',
  'windows-1252',
  'iso-8859-1',
  'shift_jis',
])

/** Decode BOM, then HTTP charset, then initial HTML metadata, otherwise UTF-8. */
export function decodeDocument(bytes: Uint8Array, contentType: string, html: boolean) {
  const bom =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? 'utf-8'
      : bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : undefined
  const header = /charset\s*=\s*["']?([^\s;"']+)/iu.exec(contentType)?.[1]
  const prefix = new TextDecoder().decode(bytes.slice(0, 1_024))
  const meta = html ? /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'/>]+)/iu.exec(prefix)?.[1] : undefined
  const charset = (bom ?? header ?? meta ?? 'utf-8').toLowerCase()
  if (!encodings.has(charset)) throw new Error('unsupported_charset')
  try {
    const decoded = new TextDecoder(charset, { fatal: true, ignoreBOM: false }).decode(bytes)
    if (new TextEncoder().encode(decoded).byteLength > 2 * 1_024 * 1_024)
      throw new Error('response_too_large')
    return { decoded, charset }
  } catch (error) {
    if (error instanceof Error && error.message === 'response_too_large') throw error
    throw new Error('invalid_encoding')
  }
}

/** Strip executable, navigation and explicitly hidden subtrees before collecting text. */
export async function extractHtml(html: string, maximum: number, signal: AbortSignal) {
  signal.throwIfAborted()
  const clean = await new HTMLRewriter()
    .on(
      'script,style,noscript,template,form,nav,iframe,object,embed,svg,[hidden],[aria-hidden="true"]',
      {
        element(element) {
          element.remove()
        },
      },
    )
    .on('[style]', {
      element(element) {
        if (
          /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))(?:\s*!important)?\s*(?:;|$)/iu.test(
            element.getAttribute('style') ?? '',
          )
        )
          element.remove()
      },
    })
    .transform(new Response(html))
    .text()
  signal.throwIfAborted()
  const collected = { title: '', article: '', main: '', body: '' }
  const rewriter = new HTMLRewriter()
  for (const key of ['title', 'article', 'main', 'body'] as const) {
    rewriter.on(key, {
      text(chunk) {
        collected[key] += chunk.text
      },
    })
    rewriter.on(
      `${key} p,${key} h1,${key} h2,${key} h3,${key} h4,${key} h5,${key} h6,${key} li,${key} pre,${key} br,${key} div`,
      {
        element(element) {
          collected[key] += '\n'
          element.onEndTag(() => {
            collected[key] += '\n'
          })
        },
      },
    )
  }
  await rewriter.transform(new Response(clean)).arrayBuffer()
  signal.throwIfAborted()
  const body = (collected.article.trim() || collected.main.trim() || collected.body.trim()).replace(
    /\n[\t ]*\n(?:[\t ]*\n)+/gu,
    '\n\n',
  )
  if (html.length > 0 && body.length === 0) throw new Error('empty_extraction')
  return {
    title: limitText(collected.title.trim(), 300),
    text: limitText(body, maximum),
    truncated: Array.from(body).length > maximum,
  }
}
