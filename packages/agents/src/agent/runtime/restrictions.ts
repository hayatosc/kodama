/**
 * Restrictions that stop an agent's next external call without waiting for idle: the state the
 * object holds, checked before every model request, tool call, and message to another agent.
 *
 * @see docs/agents.md — Restrictions
 *
 * @module
 */
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai'
import { defineExtension, hook, ToolTask } from '@earendil-works/pi-durable'
import type { Extension } from '@earendil-works/pi-durable'
import { CALLING_STATUSES } from '../../control-plane/lifecycle.ts'
import type { AgentSettings, AgentStatus } from '../../protocol.ts'

/** The storage key of the object's copy of its registry state. */
export const STATUS_KEY = 'kodama:status'

/** Why the object may not make an external call now, or `undefined` when it may. */
export type Refusal = () => string | undefined

/**
 * The refusal from the object's copy of its state; with no copy yet, calls are allowed. Reads the
 * synchronous key-value API, so it costs no round trip on each call.
 */
export function statusRefusal(storage: DurableObjectStorage): Refusal {
  return () => {
    const status = storage.kv.get<AgentStatus>(STATUS_KEY)
    if (status === undefined || CALLING_STATUSES.includes(status)) return undefined
    return `agent_restricted: external calls are stopped while the agent is ${status}`
  }
}

/** The first refusal of `refusals`; later issues add credential and permission checks here. */
export function anyRefusal(...refusals: readonly Refusal[]): Refusal {
  return () => {
    for (const refusal of refusals) {
      const reason = refusal()
      if (reason !== undefined) return reason
    }
    return undefined
  }
}

/**
 * @throws {@link Error} With the reason, when `refusal` refuses.
 */
export function assertAllowed(refusal: Refusal): void {
  const reason = refusal()
  if (reason !== undefined) throw new Error(reason)
}

/** A failed response that Pi does not retry, so the turn settles as `unanswered`. */
function refusedResponse(provider: string, api: string, model: string, reason: string) {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  const message: AssistantMessage = {
    role: 'assistant',
    content: [],
    api,
    provider,
    model,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: zero },
    stopReason: 'error',
    errorMessage: reason,
    timestamp: Date.now(),
  }
  const stream = createAssistantMessageEventStream()
  stream.push({ type: 'error', reason: 'error', error: message })
  stream.end(message)
  return stream
}

/**
 * `models` with every model request checked against `refusal` first; a refused request fails
 * without reaching the provider.
 */
export function guardedModels(models: Models, refusal: Refusal): Models {
  const guarded: Models = Object.create(models)
  guarded.streamSimple = (model, context, options) => {
    const reason = refusal()
    if (reason === undefined) return models.streamSimple(model, context, options)
    return refusedResponse(model.provider, model.api, model.id, reason)
  }
  return guarded
}

/** The applied settings a tool decision reads; `undefined` before the first version. */
export type AppliedSettings = () => Promise<AgentSettings | undefined>

/**
 * The extension that checks every tool call: `refusal` first, then the applied version's
 * `toolPolicy`, and for the `remember` tool `trusted` and `memoryPolicy.remember`.
 */
export function toolGuardExtension(
  refusal: Refusal,
  settings: AppliedSettings,
  trusted: () => Promise<void> = async () => {},
): Extension {
  return defineExtension({
    name: 'kodama-restrictions',
    hooks: [
      hook(ToolTask, {
        beforeTool: async (call) => {
          let reason = refusal()
          const applied = await settings()
          if (!reason && call.name === 'remember') {
            try {
              await trusted()
            } catch {
              reason = 'untrusted_context'
            }
          }
          if (
            (call.name === 'web_search' || call.name === 'web_fetch') &&
            !applied?.tools.includes(call.name)
          )
            reason ??= 'tool_disabled'
          if (applied?.toolPolicy?.[call.name] === 'deny')
            reason ??= `tool ${call.name} is denied by the agent's tool policy`
          if (call.name === 'remember' && applied?.memoryPolicy.remember === false)
            reason ??= "remember is disabled by the agent's memory policy"
          return reason ? { block: reason } : undefined
        },
      }),
    ],
  })
}
