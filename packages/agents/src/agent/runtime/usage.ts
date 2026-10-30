/** Observe Pi results at the shared generation/compaction Models boundary. @module */
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { CredentialStore } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai'
import type { ObserveCredential } from '../../credentials/store.ts'
import { createAgentModels } from '../../control-plane/models.ts'
import type { LocalDb } from '../local-db/local.ts'
import { startUsage, finishUsage, selectUsageCredential } from '../local-db/usage.ts'
import type { UsageAttribution } from '../local-db/usage.ts'

/** Store key shared with the memory runner; restored before any resumed model request. */
export const USAGE_CONTEXT_KEY = 'kodama:usage-context'

/** Models facade with exactly one durable row per outer stream, including completeSimple. */
export function usageModels(
  models: Models,
  local: LocalDb,
  attribution: () => Promise<UsageAttribution>,
  scoped: (observe: ObserveCredential) => CredentialStore,
  fatal: () => never,
): Models {
  const recorded: Models = Object.create(models)
  recorded.streamSimple = (model, context, options) => {
    const output = createAssistantMessageEventStream()
    // Pi must receive a stream immediately; its producer persists intent before starting auth.
    void (async () => {
      const seq = startUsage(local, await attribution(), model)
      const credentials = scoped((selection) => {
        try {
          selectUsageCredential(local, seq, selection)
        } catch {
          // Auth adapters normalize exceptions into provider errors. Abort here, before that
          // normalization can cause Pi to retry an accounting storage failure.
          fatal()
        }
      })
      const input = createAgentModels(credentials).streamSimple(model, context, options)
      for await (const event of input) {
        if (event.type === 'done' || event.type === 'error') {
          finishUsage(local, seq, event.type === 'done' ? event.message : event.error)
        }
        output.push(event)
      }
      const message = await input.result()
      finishUsage(local, seq, message)
      output.end(message)
    })().catch(fatal)
    return output
  }
  return recorded
}
