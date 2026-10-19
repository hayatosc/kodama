function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function messageText(value: unknown): string {
  if (!object(value) || value.role !== 'assistant' || !Array.isArray(value.content)) return ''
  return value.content
    .flatMap((block: unknown) =>
      object(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
    )
    .join('')
}

function entryText(value: unknown): string {
  return object(value) && Array.isArray(value.model) ? value.model.map(messageText).join('') : ''
}

/** Decode SSE incrementally, including UTF-8 and frames split across RPC chunks. */
export async function printStream(
  stream: ReadableStream<Uint8Array>,
  write: (text: string) => void,
  events = false,
): Promise<void> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let terminal = false
  let printed = ''
  const entries = new Map<number, string>()
  const rendered = new Set<number>()
  const render = (text: string) => {
    if (text.startsWith(printed)) write(text.slice(printed.length))
    else write(`\n${text}`)
    printed = text
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        const frame = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = frame
          .split('\n')
          .find((line) => line.startsWith('data: '))
          ?.slice(6)
        if (data) {
          const event: unknown = JSON.parse(data)
          if (!object(event)) throw new Error('Invalid agent event')
          if (events) write(`${data}\n`)
          if (!events && event.type === 'snapshot' && Array.isArray(event.entries)) {
            for (const entry of event.entries) {
              if (object(entry) && typeof entry.id === 'number')
                entries.set(entry.id, entryText(entry))
            }
          }
          if (!events && event.type === 'message_start') {
            if (printed) write('\n')
            printed = ''
            render(messageText(event.message))
          }
          if (!events && event.type === 'message_update' && Array.isArray(event.changes)) {
            for (const change of event.changes) {
              if (
                object(change) &&
                change.type === 'text_delta' &&
                typeof change.delta === 'string'
              ) {
                write(change.delta)
                printed += change.delta
              }
            }
          }
          if (!events && event.type === 'message_end' && object(event.entry)) {
            const text = entryText(event.entry)
            render(text)
            if (typeof event.entry.id === 'number') {
              entries.set(event.entry.id, text)
              rendered.add(event.entry.id)
            }
          }
          if (event.type === 'submission' && object(event.record)) {
            if (event.record.status === 'unanswered') {
              throw new Error(`Agent did not answer: ${JSON.stringify(event.record)}`)
            }
            if (event.record.status === 'done') {
              terminal = true
              const answer = event.record.answer
              if (!events && typeof answer === 'number' && !rendered.has(answer)) {
                const text = entries.get(answer)
                if (text !== undefined) render(text)
              }
            }
          }
        }
        end = buffer.indexOf('\n\n')
      }
    }
    if (!terminal)
      throw new Error('Connection closed before completion; retry with the same request ID')
    if (!events) write('\n')
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
