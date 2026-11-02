/**
 * Working-agent web admission, scoped authentication and in-memory rate/cooldown control.
 *
 * @see docs/agents.md — Public web tools
 *
 * @module
 */
import { AgentDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import type { CredentialStore } from '@earendil-works/pi-ai'
import type { Context } from '@earendil-works/chord/context'
import { deadline } from '../../lib/deadline.ts'
import type { AgentSettings } from '../../protocol.ts'
import type { ObserveCredential } from '../../credentials/store.ts'
import { createAgentModels } from '../../control-plane/models.ts'
import type { LocalDb } from '../../agent/local-db/local.ts'
import { admitWeb, grantUrls } from '../../agent/local-db/external-data.ts'
import { containsUrl, normalizeQuery, normalizeUrl } from './url.ts'
import { nativeSearch, requireSearchCredential, searchRoute } from './search.ts'
import { keylessSearch } from './providers/keyless.ts'
import type { KeylessAttempt, KeylessProvider, ProviderState } from './providers/keyless.ts'
import { fetchPage } from './fetch.ts'
import { externalEnvelope } from './search-result.ts'

/** In-memory per-object concurrency, rolling rate windows, 429 cooldowns and Parallel session. */
export interface WebState {
  inFlight: number
  keylessInFlight: number
  searchAdmissions: number[]
  fetchAdmissions: number[]
  keylessAttempts: number[]
  providers: Map<KeylessProvider, ProviderState>
  sessionId?: string
}

/** Create fresh in-memory web runtime state for one agent object. */
export function createWebState(): WebState {
  return {
    inFlight: 0,
    keylessInFlight: 0,
    searchAdmissions: [],
    fetchAdmissions: [],
    keylessAttempts: [],
    providers: new Map(),
  }
}

function pruneWindow(timestamps: number[], cutoff: number): void {
  let expired = 0
  while (expired < timestamps.length && (timestamps[expired] ?? 0) < cutoff) expired++
  if (expired > 0) timestamps.splice(0, expired)
}

/** Reserve in-memory concurrency capacity during scoped auth and transport. */
export function reserveWeb(state: WebState, keyless: boolean): () => void {
  if (state.inFlight >= 2 || (keyless && state.keylessInFlight >= 1)) throw new Error('busy')
  state.inFlight++
  if (keyless) state.keylessInFlight++
  let released = false
  return () => {
    if (released) return
    released = true
    state.inFlight--
    if (keyless) state.keylessInFlight--
  }
}

/** Check the 60-second rolling admission window before consuming permissions or marking contact. */
export function checkAdmissionRate(
  state: WebState,
  tool: 'web_search' | 'web_fetch',
  now = Date.now(),
): void {
  const window = tool === 'web_search' ? state.searchAdmissions : state.fetchAdmissions
  pruneWindow(window, now - 60_000)
  if (window.length >= (tool === 'web_search' ? 10 : 30)) throw new Error('rate_limited')
}

/** Record an admitted web call in the 60-second rolling window. */
export function recordAdmission(
  state: WebState,
  tool: 'web_search' | 'web_fetch',
  now = Date.now(),
): void {
  const window = tool === 'web_search' ? state.searchAdmissions : state.fetchAdmissions
  window.push(now)
}

/** Read in-memory cooldown state for a keyless provider. */
export function searchProviderState(
  state: WebState,
  provider: KeylessProvider,
): ProviderState | undefined {
  return state.providers.get(provider)
}

function checkSearchAttemptRate(state: WebState, now: number): void {
  pruneWindow(state.keylessAttempts, now - 60_000)
  if (state.keylessAttempts.length >= 10) throw new Error('rate_limited')
}

/** Enforce the 60-second rolling keyless attempt limit before sending. */
export function startSearchAttempt(state: WebState, now = Date.now()): void {
  checkSearchAttemptRate(state, now)
  state.keylessAttempts.push(now)
}

/** Update in-memory provider cooldown and consecutive-429 streak before rotating. */
export function finishSearchAttempt(
  state: WebState,
  attempt: KeylessAttempt,
  next: ProviderState | undefined,
): void {
  if (next) state.providers.set(attempt.provider, next)
}

/** Current restrictions override known URLs, including before each redirect/rotation. */
export function requireWebEnabled(
  settings: AgentSettings | undefined,
  tool: string,
  refusal: string | undefined,
): void {
  if (refusal) throw new Error('agent_restricted')
  if (!settings?.tools.includes(tool)) throw new Error('tool_disabled')
  if (settings.toolPolicy?.[tool] === 'deny') throw new Error('tool_denied')
}

const errors = new Set([
  'untrusted_context',
  'unverified_url',
  'query_contains_url',
  'busy',
  'rate_limited',
  'tool_disabled',
  'tool_denied',
  'agent_restricted',
  'unsupported_credential_kind',
  'provider_rate_limited',
  'provider_failed',
  'provider_response_invalid',
  'search_not_performed',
  'search_rate_limited',
  'unsupported_content_type',
  'empty_extraction',
  'redirect_loop',
  'too_many_redirects',
  'invalid_redirect',
  'redirect_downgrade',
  'fetch_failed',
  'response_too_large',
  'unsupported_charset',
  'invalid_encoding',
  'invalid_max_chars',
  'invalid_query',
  'invalid_url',
  'result_too_large',
])

/** How the model continues after a refusal that guards data leaving through a URL. */
const hints: Partial<Record<string, string>> = {
  unverified_url:
    'This URL did not come from the owner, a search result or a fetched page. Find the page with web_search, then fetch a URL from its results.',
  query_contains_url:
    'A search query may not contain a URL. Search with words instead, or fetch a URL from earlier results.',
}

/** Stable error codes only, never exception bodies from authentication or external transports. */
export function webFailure(error: unknown, signal: AbortSignal): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout'
  if (signal.aborted)
    return signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'aborted'
  return error instanceof Error && errors.has(error.message) ? error.message : 'web_failed'
}

/** Execute one unsafe task; no native failure can select a different route or repeat traffic. */
export async function executeWeb(
  local: LocalDb,
  webState: WebState,
  harness: Harness,
  settings: () => Promise<AgentSettings | undefined>,
  scoped: (observe: ObserveCredential) => CredentialStore,
  serial: <T>(operation: () => Promise<T>) => Promise<T>,
  refusal: () => string | undefined,
  tool: 'web_search' | 'web_fetch',
  argument: string,
  context: Context,
  maximum?: number,
): Promise<string> {
  using limit = deadline(15_000, context.abortSignal)
  const signal = limit.signal
  let admitted = false
  let credentialRefusal: string | undefined
  let releaseSlot: (() => void) | undefined
  try {
    signal.throwIfAborted()
    const normalized = tool === 'web_search' ? normalizeQuery(argument) : normalizeUrl(argument)
    if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 1000 || maximum > 20000))
      throw new Error('invalid_max_chars')
    const applied = await settings()
    requireWebEnabled(applied, tool, refusal())
    const state = await harness.snapshot(AgentDoc, ROOT_CONVERSATION_ID, context)
    const models = createAgentModels(
      scoped((selection) => {
        if (route) {
          try {
            requireSearchCredential(route, selection.kind)
          } catch {
            credentialRefusal = 'unsupported_credential_kind'
            throw new Error(credentialRefusal)
          }
        }
      }),
    )
    const model = state?.model
      ? models.getModel(state.model.provider, state.model.modelId)
      : undefined
    if (!model) throw new Error('web_failed')
    const route = tool === 'web_search' ? searchRoute(model, applied?.webSearchRoute) : undefined
    await serial(async () => {
      signal.throwIfAborted()
      requireWebEnabled(await settings(), tool, refusal())
      releaseSlot = reserveWeb(webState, tool === 'web_search' && !route)
    })
    const admit = async (attemptSignal?: AbortSignal) =>
      serial(async () => {
        signal.throwIfAborted()
        requireWebEnabled(await settings(), tool, refusal())
        attemptSignal?.throwIfAborted()
        // Check the attempt limit in the admission section, so a local refusal marks no contact.
        if (attemptSignal) checkSearchAttemptRate(webState, Date.now())
        if (!admitted) {
          const root = String(ROOT_CONVERSATION_ID)
          const currentSettings = await settings()
          signal.throwIfAborted()
          attemptSignal?.throwIfAborted()
          requireWebEnabled(currentSettings, tool, refusal())
          // A provider's own search may open a URL in the query and carry data out in it.
          if (tool === 'web_search' && containsUrl(normalized))
            throw new Error('query_contains_url')
          const now = Date.now()
          checkAdmissionRate(webState, tool, now)
          admitWeb(local, { root, tool, argument: normalized })
          recordAdmission(webState, tool, now)
          admitted = true
        }
        signal.throwIfAborted()
        if (attemptSignal) {
          attemptSignal.throwIfAborted()
          startSearchAttempt(webState)
        }
      })
    if (tool === 'web_fetch') {
      const result = await fetchPage(normalized, maximum, signal, async () => {
        await admit()
      })
      const output = externalEnvelope(tool, normalized, result)
      grantUrls(local, String(ROOT_CONVERSATION_ID), 'page', result.links)
      return output
    }
    const auth = route ? await models.getAuth(model, { signal }) : undefined
    signal.throwIfAborted()
    if (route && !auth?.auth.apiKey) throw new Error('credential_unavailable')
    const result =
      route && auth?.auth.apiKey
        ? await nativeSearch(route, model, normalized, auth.auth.apiKey, signal, async () => {
            await admit()
          })
        : await keylessSearch(
            normalized,
            signal,
            (provider) => searchProviderState(webState, provider),
            async (_provider, attemptSignal) => admit(attemptSignal),
            (attempt, next) => finishSearchAttempt(webState, attempt, next),
            webState.sessionId,
          )
    if (result.result === undefined) {
      return JSON.stringify({
        error: result.error,
        retryAt: result.retryAt,
        triedProviders: result.attempts.map((attempt) => attempt.provider),
      })
    }
    if ('sessionId' in result && result.sessionId) webState.sessionId = result.sessionId
    const output = externalEnvelope(tool, normalized, {
      ...result.result,
      provider: result.provider,
      model: result.model,
      api: result.api,
      fetchedAt: result.fetchedAt,
    })
    grantUrls(
      local,
      String(ROOT_CONVERSATION_ID),
      'search',
      result.result.sources.map((source) => source.url),
    )
    return output
  } catch (error) {
    const reason = credentialRefusal ?? webFailure(error, signal)
    const hint = hints[reason]
    return JSON.stringify(hint ? { error: reason, hint } : { error: reason })
  } finally {
    releaseSlot?.()
  }
}
