/** Buffer provider output until redacted, before Pi can persist or stream a split secret. @module */
import { defineExtension, hook, ToolTask } from '@earendil-works/pi-durable'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai/models'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { redactData, redactSecrets } from './redaction.ts'

/** Sanitize tool results before Pi commits them, including exception-derived content. */
export function redactionExtension(redact: (text: string) => string) {
  return defineExtension({
    name: 'kodama-redaction',
    hooks: [
      hook(ToolTask, {
        afterTool: (_call, result) => redactData(result, redact),
      }),
    ],
  })
}

/** Wrap a newly created model registry before use; split secrets never cross its stream boundary. */
export function redactedModels(
  models: Models,
  redact: (text: string) => string = redactSecrets,
): Models {
  async function guarded<T extends object>(operation: () => Promise<T>): Promise<T> {
    try {
      return redactData(await operation(), redact)
    } catch (error) {
      throw new Error(redact(error instanceof Error ? error.message : 'Provider request failed'))
    }
  }
  const completeSimple = models.completeSimple.bind(models)
  models.completeSimple = (model, context, options) =>
    guarded(() => completeSimple(model, context, options))
  const fetchDeferred = models.fetchDeferred.bind(models)
  models.fetchDeferred = (model, handle, options) =>
    guarded(() => fetchDeferred(model, handle, options))
  const streamSimple = models.streamSimple.bind(models)
  models.streamSimple = (model, context, options) => {
    const output = createAssistantMessageEventStream()
    void (async () => {
      let message: AssistantMessage
      try {
        message = redactData(await streamSimple(model, context, options).result(), redact)
      } catch (error) {
        message = {
          role: 'assistant',
          content: [],
          api: model.api,
          model: model.id,
          provider: model.provider,
          usage: {
            input: 0,
            output: 0,
            totalTokens: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'error',
          timestamp: Date.now(),
          errorMessage: redact(error instanceof Error ? error.message : 'Provider request failed'),
        }
      }
      if (message.stopReason === 'pending') message.stopReason = 'error'
      output.push({ type: 'start', partial: message })
      for (const [contentIndex, content] of message.content.entries()) {
        if (content.type === 'text')
          output.push({ type: 'text_delta', contentIndex, delta: content.text, partial: message })
        if (content.type === 'thinking')
          output.push({
            type: 'thinking_delta',
            contentIndex,
            delta: content.thinking,
            partial: message,
          })
      }
      if (message.stopReason === 'error' || message.stopReason === 'aborted')
        output.push({ type: 'error', reason: message.stopReason, error: message })
      else output.push({ type: 'done', reason: message.stopReason, message })
      output.end(message)
    })()
    return output
  }
  return models
}
