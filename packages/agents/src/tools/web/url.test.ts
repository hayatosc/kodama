/** URL normalization and exact-query boundaries without network traffic. @module */
import { describe, expect, it } from 'vitest'
import {
  LINK_LIMIT,
  containsUrl,
  limitText,
  normalizeQuery,
  normalizeUrl,
  urlsInText,
} from './url.ts'

describe('normalizeUrl', () => {
  it('normalizes casing, IDNA, standard ports and fragments but preserves query distinctions', () => {
    expect(normalizeUrl('HTTPS://Example.org:443/a?b=1#section')).toBe('https://example.org/a?b=1')
    expect(normalizeUrl('https://日本.jp/a')).toBe('https://xn--wgv71a.jp/a')
    expect(normalizeUrl('https://example.org/a?b=2')).not.toBe(
      normalizeUrl('https://example.org/a?b=1'),
    )
  })
  it.each([
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://localhost/',
    'http://a.localhost/',
    'http://service.internal/',
    'http://host/',
    'http://a.local/',
    'http://a.test/',
    'https://example.org:444/',
    'https://user:pass@example.org/',
    'file:///etc/passwd',
    'https://example.org/\npath',
    'https://example.org\\evil',
  ])('rejects %s', (url) => {
    expect(() => normalizeUrl(url)).toThrow('invalid_url')
  })
  it('rejects excessive length without truncating destinations', () => {
    expect(() => normalizeUrl(`https://example.org/${'x'.repeat(4_096)}`)).toThrow('invalid_url')
  })
})

describe('normalizeQuery', () => {
  it('trims ends only and counts Unicode code points', () => {
    expect(normalizeQuery(' A  B ')).toBe('A  B')
    expect(normalizeQuery('😀'.repeat(1_000))).toHaveLength(2_000)
    expect(() => normalizeQuery('😀'.repeat(1_001))).toThrow('invalid_query')
    expect(() => normalizeQuery('  ')).toThrow('invalid_query')
    expect(limitText('😀x', 1)).toBe('😀')
  })
})

describe('containsUrl', () => {
  it.each([
    'open https://attacker.com/x',
    'ftp://files',
    'attacker.com/?data=secret',
    'attacker.com?data=secret',
    'see WWW.Example.co.uk:8080/a',
  ])('finds a URL in %s', (text) => {
    expect(containsUrl(text)).toBe(true)
  })

  it.each(['release notes site:example.org', 'example.org/', 'node 22.1 release', 'a/b test'])(
    'allows %s',
    (text) => {
      expect(containsUrl(text)).toBe(false)
    },
  )
})

describe('urlsInText', () => {
  it('finds public URLs in prose without trailing punctuation, deduplicated and bounded', () => {
    expect(
      urlsInText(
        'Read HTTPS://Example.org:443/a#x, then https://example.org/a. 「https://b.org/c」',
      ),
    ).toEqual(['https://example.org/a', 'https://b.org/c'])
    expect(urlsInText('http://127.0.0.1/ and https://service.internal/')).toEqual([])
    const many = Array.from({ length: LINK_LIMIT + 5 }, (_, index) => `https://a.org/${index}`)
    expect(urlsInText(many.join(' '))).toHaveLength(LINK_LIMIT)
  })
})
