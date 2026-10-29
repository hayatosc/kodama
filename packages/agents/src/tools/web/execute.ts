/** Working-agent web admission, scoped authentication and existing-ledger accounting. @module */
import { AgentDoc, LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import type { Harness } from '@earendil-works/pi-durable'
import type { CredentialStore } from '@earendil-works/pi-ai'
import type { Context } from '@earendil-works/chord/context'
import { deadline } from '../../lib/deadline.ts'
import { currentRunInputs } from '../../agent/runtime/inputs.ts'
import type { AgentSettings } from '../../protocol.ts'
import type { ObserveCredential } from '../../credentials/store.ts'
import { createAgentModels } from '../../control-plane/models.ts'
import { latestEntryId } from '../../memory/transcript.ts'
import { parseMessage } from '../../validation.ts'
import type { LocalDb } from '../../agent/local-db/local.ts'
import {
  adoptPermissions,
  admitWeb,
  grantSources,
  reserveWeb,
} from '../../agent/local-db/external-data.ts'
import {
  startToolUsage,
  finishToolUsage,
  observeToolUsage,
  selectUsageCredential,
  toolUsageActive,
} from '../../agent/local-db/usage.ts'
import type { UsageAttribution } from '../../agent/local-db/usage.ts'
import {
  searchProviderState,
  startSearchAttempt,
  finishSearchAttempt,
  saveSearchSession,
  searchSession,
  searchAttempts,
} from '../../agent/local-db/web-search.ts'
import { normalizeQuery, normalizeUrl } from './url.ts'
import { nativeSearch, requireSearchCredential, searchRoute } from './search.ts'
import { keylessSearch } from './providers/keyless.ts'
import { fetchPage } from './fetch.ts'
import { externalEnvelope } from './search-result.ts'

/** Current restrictions override exact permissions, including before each redirect/rotation. */
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
  harness: Harness,
  settings: () => Promise<AgentSettings | undefined>,
  scoped: (observe: ObserveCredential) => CredentialStore,
  serial: <T>(operation: () => Promise<T>) => Promise<T>,
  refusal: () => string | undefined,
  attribution: UsageAttribution,
  tool: 'web_search' | 'web_fetch',
  argument: string,
  task: string,
  context: Context,
  maximum?: number,
): Promise<string> {
  using limit = deadline(15_000, context.abortSignal)
  const signal = limit.signal
  const seq = startToolUsage(local, attribution, task, tool)
  if (!toolUsageActive(local, seq)) return JSON.stringify({ error: 'interrupted' })
  let admitted = false
  let admittedRun: string | undefined
  let httpCount = 0
  let permission: string | null = null
  let skipped: string[] = []
  let credentialRefusal: string | undefined
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
        selectUsageCredential(local, seq, selection)
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
    observeToolUsage(local, seq, {
      argument: normalized,
      provider: route?.provider ?? null,
      model: route ? model.id : null,
      api: null,
    })
    await serial(async () => {
      signal.throwIfAborted()
      requireWebEnabled(await settings(), tool, refusal())
      reserveWeb(
        local,
        seq,
        tool === 'web_search' && !route,
        route?.dialect ?? (tool === 'web_fetch' ? 'http-get' : 'keyless-mcp'),
      )
    })
    const admit = async () =>
      serial(async () => {
        signal.throwIfAborted()
        requireWebEnabled(await settings(), tool, refusal())
        if (!admitted) {
          const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context)
          const inputs = await currentRunInputs(harness, context)
          if (!live?.run || !inputs) throw new Error('untrusted_context')
          // Pi hands generation task ownership over after each tool round; the first
          // adopted submission is stable until this logical run settles.
          const first = live.run.inputs[0]
          if (first === undefined) throw new Error('untrusted_context')
          const run = String(first)
          observeToolUsage(local, seq, { root: String(ROOT_CONVERSATION_ID), run })
          for (const input of inputs) {
            if (
              input.kind !== 'kodama.owner-message' ||
              !input.data ||
              typeof input.data !== 'object' ||
              Array.isArray(input.data)
            )
              continue
            const permissions = parseMessage({
              requestId: 'permission',
              content: 'permission',
              webPermissions: input.data['webPermissions'],
            }).webPermissions
            if (permissions)
              adoptPermissions(local, String(ROOT_CONVERSATION_ID), run, input.id, permissions)
          }
          const eligibleThrough = (await latestEntryId(harness)) ?? 0
          const currentSettings = await settings()
          signal.throwIfAborted()
          requireWebEnabled(currentSettings, tool, refusal())
          permission = admitWeb(local, {
            seq,
            root: String(ROOT_CONVERSATION_ID),
            run,
            inputs: inputs.map((input) => input.id),
            tool,
            argument: normalized,
            keyless: tool === 'web_search' && !route,
            eligibleThrough,
          })
          admittedRun = run
          admitted = true
        }
        signal.throwIfAborted()
      })
    if (tool === 'web_fetch') {
      const result = await fetchPage(normalized, maximum, signal, async () => {
        await admit()
        observeToolUsage(local, seq, { httpCount: ++httpCount })
      })
      observeToolUsage(local, seq, { receivedBytes: result.receivedBytes, resultCount: 1 })
      const output = externalEnvelope(tool, normalized, result)
      finishToolUsage(local, seq, 'succeeded', { permission })
      return output
    }
    const auth = route ? await models.getAuth(model, { signal }) : undefined
    signal.throwIfAborted()
    if (route && !auth?.auth.apiKey) throw new Error('credential_unavailable')
    const result =
      route && auth?.auth.apiKey
        ? await nativeSearch(route, model, normalized, auth.auth.apiKey, signal, async () => {
            await admit()
            observeToolUsage(local, seq, { httpCount: ++httpCount })
          })
        : await keylessSearch(
            normalized,
            signal,
            (provider) => searchProviderState(local, provider),
            async (provider, attemptSignal) => {
              await admit()
              await serial(async () => {
                const currentSettings = await settings()
                attemptSignal.throwIfAborted()
                requireWebEnabled(currentSettings, tool, refusal())
                startSearchAttempt(local, seq, provider)
                observeToolUsage(local, seq, {
                  httpCount: ++httpCount,
                  provider,
                  api: provider === 'tavily' ? 'keyless-rest' : 'keyless-mcp',
                })
              })
            },
            (attempt, next) => finishSearchAttempt(local, seq, attempt, next),
            searchSession(local),
            (provider) => skipped.push(provider),
          )
    if ('skippedProviders' in result) skipped = result.skippedProviders
    if (result.result === undefined) {
      finishToolUsage(local, seq, 'failed', {
        reason: result.error,
        retryAt: result.retryAt ?? null,
        skippedProviders: skipped,
        attempts: searchAttempts(local, seq).map((attempt) => JSON.stringify(attempt)),
        permission,
      })
      return JSON.stringify({
        error: result.error,
        retryAt: result.retryAt,
        triedProviders: result.attempts.map((attempt) => attempt.provider),
      })
    }
    if ('sessionId' in result && result.sessionId) saveSearchSession(local, seq, result.sessionId)
    const attempts = searchAttempts(local, seq)
    const bytes =
      'receivedBytes' in result
        ? result.receivedBytes
        : attempts.reduce((sum, attempt) => sum + (attempt.bytes ?? 0), 0)
    observeToolUsage(local, seq, {
      provider: result.provider,
      model: result.model,
      api: result.api,
      searchCount: result.result.searchCount,
      countKind: result.result.countKind,
      resultCount: result.result.sources.length,
      input: result.result.inputTokens,
      output: result.result.outputTokens,
      receivedBytes: bytes,
    })
    const output = externalEnvelope(tool, normalized, {
      ...result.result,
      provider: result.provider,
      model: result.model,
      api: result.api,
      fetchedAt: result.fetchedAt,
    })
    await serial(async () => {
      signal.throwIfAborted()
      const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, context)
      if (!live?.run || admittedRun === undefined || String(live.run.inputs[0]) !== admittedRun)
        throw new Error('untrusted_context')
      grantSources(
        local,
        String(ROOT_CONVERSATION_ID),
        admittedRun,
        result.result.sources.map((source) => source.url),
      )
      finishToolUsage(local, seq, 'succeeded', {
        permission,
        skippedProviders: skipped,
        attempts: attempts.map((attempt) => JSON.stringify(attempt)),
      })
    })
    return output
  } catch (error) {
    const reason = credentialRefusal ?? webFailure(error, signal)
    finishToolUsage(local, seq, signal.aborted ? 'aborted' : admitted ? 'failed' : 'blocked', {
      reason,
      permission,
      skippedProviders: skipped,
      attempts: searchAttempts(local, seq).map((attempt) => JSON.stringify(attempt)),
    })
    return JSON.stringify({ error: reason })
  }
}
