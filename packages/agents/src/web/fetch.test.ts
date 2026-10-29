/** Public GET validation and inert extraction using local mocked responses only. @module */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPage } from './fetch.ts'

afterEach(() => vi.restoreAllMocks())

describe('fetchPage', () => {
  it('uses only GET and extracts article without hidden or executable content', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          '<html><head><title>Title</title></head><body><nav>menu</nav><main>Main</main><article><h1>Heading</h1><p>Visible</p><p hidden>secret</p><script>attack()</script><form>input</form><div style="display:none">hidden</div></article></body></html>',
          { headers: { 'content-type': 'text/html;charset=utf-8' } },
        ),
      )
    const result = await fetchPage('https://example.org/#fragment')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(
      'https://example.org/',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    )
    expect(result.title).toBe('Title')
    expect(result.text).toContain('Heading')
    expect(result.text).toContain('Visible')
    for (const value of ['Main', 'menu', 'secret', 'attack', 'input', 'hidden'])
      expect(result.text).not.toContain(value)
    expect(result.dnsCount).toBe(0)
  })
  it.each(['http://example.org/', 'https://127.0.0.1/', 'https://service.internal/'])(
    'rejects unsafe redirect to %s without a second send',
    async (location) => {
      const request = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 302, headers: { location } }))
      await expect(fetchPage('https://example.org/')).rejects.toThrow()
      expect(request).toHaveBeenCalledTimes(1)
    },
  )
  it('rejects loops, unsupported types and transfer overflow', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: '/' } }))
    await expect(fetchPage('https://example.org/')).rejects.toThrow('redirect_loop')
    request.mockResolvedValue(
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
    )
    await expect(fetchPage('https://example.org/')).rejects.toThrow('unsupported_content_type')
    request.mockResolvedValue(
      new Response('x'.repeat(2 * 1_024 * 1_024 + 1), {
        headers: { 'content-type': 'text/plain' },
      }),
    )
    await expect(fetchPage('https://example.org/')).rejects.toThrow('response_too_large')
  })
  it('distinguishes empty success and character truncation from transfer limits', async () => {
    const request = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { headers: { 'content-type': 'text/plain' } }))
    expect(await fetchPage('https://example.org/')).toMatchObject({ text: '', truncated: false })
    request.mockResolvedValue(
      new Response('x'.repeat(1_001), { headers: { 'content-type': 'text/plain' } }),
    )
    expect(await fetchPage('https://example.org/', 1_000)).toMatchObject({
      text: 'x'.repeat(1_000),
      truncated: true,
    })
  })
  it('preserves breaks between all six heading levels', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '<body><h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6></body>',
        { headers: { 'content-type': 'text/html' } },
      ),
    )
    expect((await fetchPage('https://example.org/')).text).toBe(
      'One\n\nTwo\n\nThree\n\nFour\n\nFive\n\nSix',
    )
  })
  it('never sends after cancellation', async () => {
    const request = vi.spyOn(globalThis, 'fetch')
    await expect(fetchPage('https://example.org/', 1_000, AbortSignal.abort())).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
