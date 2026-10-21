/** Readable text of Pi entries, for extraction, the archive index, and memory prompts. */
import type { EntryRecord } from '@earendil-works/pi-durable'

/** Tool output beyond this many characters is cut; the archive keeps the full entry. */
export const TOOL_RESULT_TEXT_LIMIT = 2_000

export type EntryRole = 'user' | 'assistant' | 'tool' | 'summary' | 'other'

export interface EntryText {
  id: number
  role: EntryRole
  text: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text of message content: a string, or text blocks and tool calls. */
function contentText(content: unknown, limit: number | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] === 'text' && typeof block['text'] === 'string') parts.push(block['text'])
    if (block['type'] === 'toolCall' && typeof block['name'] === 'string') {
      parts.push(`[tool ${block['name']} ${JSON.stringify(block['arguments'] ?? {})}]`)
    }
  }
  const text = parts.join('\n')
  return limit === undefined ? text : text.slice(0, limit)
}

function roleOf(kind: string): EntryRole {
  switch (kind) {
    case 'pi.user':
      return 'user'
    case 'pi.assistant':
      return 'assistant'
    case 'pi.tool-result':
      return 'tool'
    case 'pi.compaction':
      return 'summary'
    default:
      return 'other'
  }
}

/** The entry as text, or undefined for entries that carry no conversation text. */
export function entryText(entry: EntryRecord): EntryText | undefined {
  const role = roleOf(entry.kind)
  if (role === 'other' || entry.model === undefined) return undefined
  const limit = role === 'tool' ? TOOL_RESULT_TEXT_LIMIT : undefined
  const text = entry.model
    .map((message: unknown) => (isRecord(message) ? contentText(message['content'], limit) : ''))
    .filter((part) => part.length > 0)
    .join('\n')
  return text.length === 0 ? undefined : { id: entry.id, role, text }
}
