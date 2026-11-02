/** Native OAuth loopback receiver; credentials and PKCE verifiers stay in the agents vault. @module */
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import * as v from 'valibot'

const startedSchema = v.object({
  authorizationUrl: v.string(),
  consent: v.object({
    serverId: v.string(),
    issuer: v.string(),
    resource: v.string(),
    clientId: v.string(),
    scope: v.string(),
    redirectUri: v.string(),
  }),
})

/** Start the platform browser without a shell; the URL is an argument, never executable text. */
export async function openMcpBrowser(url: string): Promise<void> {
  if (new URL(url).protocol !== 'https:') throw new Error('Invalid authorization URL')
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false, detached: true })
    child.unref()
    child.once('error', () =>
      reject(new Error('Cannot open browser; use the printed authorization URL')),
    )
    child.once('spawn', () => resolve())
  })
}

/** Listen before authorization and forward one valid callback over authenticated private RPC. */
export async function loginMcp(options: {
  serverId: string
  port?: number
  issuer?: string
  scope?: string
  requestId?: string
  initialTokenId?: string
  signal: AbortSignal
  auth: (input: unknown) => Promise<unknown>
  open: (url: string) => Promise<void>
  notify: (message: string) => void
}): Promise<unknown> {
  const browserNonce = randomBytes(32).toString('base64url')
  let expectedState = ''
  let redirectUri = ''
  let claimed = false
  let resolveResult: (value: unknown) => void = () => undefined
  let rejectResult: (error: Error) => void = () => undefined
  const result = new Promise<unknown>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })
  // A timeout can happen while discovery is in flight; attach a handler before that await.
  void result.catch(() => undefined)
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(600_000)])
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const reject = () => {
      response.writeHead(400)
      response.end('Invalid OAuth callback. Return to the terminal.')
    }
    if (
      !redirectUri ||
      request.method !== 'GET' ||
      !request.url ||
      request.url.length > 16_384 ||
      request.headers.host !== new URL(redirectUri).host
    )
      return reject()
    let url: URL
    try {
      url = new URL(request.url, redirectUri)
    } catch {
      return reject()
    }
    if (
      url.origin !== new URL(redirectUri).origin ||
      url.pathname !== '/auth/mcp/callback' ||
      claimed ||
      !expectedState
    )
      return reject()
    const state = url.searchParams.get('state') ?? ''
    const incoming = Buffer.from(state)
    const expected = Buffer.from(expectedState)
    if (
      url.searchParams.getAll('state').length !== 1 ||
      incoming.length !== expected.length ||
      !timingSafeEqual(incoming, expected)
    )
      return reject()
    const code = url.searchParams.get('code')
    const denied = url.searchParams.has('error')
    if (
      (denied && code !== null) ||
      (!denied && (!code || code.length > 8_192)) ||
      ['code', 'error', 'iss'].some((key) => url.searchParams.getAll(key).length > 1)
    )
      return reject()
    claimed = true
    void options
      .auth({
        operation: 'complete-loopback',
        state,
        browserNonce,
        loopbackRedirectUri: redirectUri,
        ...(denied ? { denied: true } : { code }),
        ...(url.searchParams.has('iss') ? { issuer: url.searchParams.get('iss') } : {}),
      })
      .then(
        (completed) => {
          response.end(
            denied
              ? 'Authorization denied. Return to the terminal.'
              : 'Authorization processed. Return to the terminal for the result.',
          )
          resolveResult(completed)
        },
        () => {
          response.writeHead(502)
          response.end(
            'Authorization could not be confirmed. Return to the terminal and reconnect; do not reload this URL.',
          )
          rejectResult(new Error('MCP authorization could not be confirmed; start a new login'))
        },
      )
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  const abort = () => rejectResult(new Error('MCP login cancelled or expired'))
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => reject(new Error('Cannot bind the MCP loopback callback port')))
      server.listen(options.port ?? 0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing loopback listener')
    redirectUri = `http://127.0.0.1:${address.port}/auth/mcp/callback`
    options.notify(`Callback: ${redirectUri}`)
    const started = v.parse(
      startedSchema,
      await options.auth({
        operation: 'begin-loopback',
        serverId: options.serverId,
        browserNonce,
        loopbackRedirectUri: redirectUri,
        issuer: options.issuer,
        scope: options.scope,
        requestId: options.requestId,
        initialTokenId: options.initialTokenId,
      }),
    )
    const authorization = new URL(started.authorizationUrl)
    expectedState = authorization.searchParams.get('state') ?? ''
    if (
      authorization.protocol !== 'https:' ||
      !expectedState ||
      started.consent.redirectUri !== redirectUri ||
      authorization.searchParams.get('redirect_uri') !== redirectUri
    )
      throw new Error('Invalid MCP authorization response')
    signal.throwIfAborted()
    options.notify(
      `Server: ${started.consent.serverId}\nIssuer: ${started.consent.issuer}\nResource: ${started.consent.resource}\nClient: ${started.consent.clientId}\nScope: ${started.consent.scope || '(none)'}\nOpen in your browser: ${authorization.href}`,
    )
    try {
      await options.open(authorization.href)
    } catch {
      options.notify('Browser launch failed. Open the printed URL manually; waiting for callback.')
    }
    return await result
  } finally {
    signal.removeEventListener('abort', abort)
    if (expectedState && !claimed) {
      try {
        await options.auth({
          operation: 'complete-loopback',
          state: expectedState,
          browserNonce,
          loopbackRedirectUri: redirectUri,
          denied: true,
        })
      } catch {
        /* Expiration recovery erases an unclaimed verifier if the local Worker is unavailable. */
      }
    }
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
