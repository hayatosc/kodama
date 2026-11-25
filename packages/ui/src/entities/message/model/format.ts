/**
 * Text formatting for the conversation parts: tool call durations and JSON arguments.
 *
 * @module
 */

/**
 * A finished tool call's duration: tenths of a second under 10 seconds (`0.4s`, `2.1s`), whole
 * seconds under a minute (`38s`), then minutes and seconds (`1m 05s`).
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 10_000) return `${(durationMs / 1000).toFixed(1)}s`
  return formatElapsed(durationMs)
}

/**
 * A running tool call's elapsed time in whole seconds (`12s`, `1m 05s`), so the count steps once
 * a second instead of flickering tenths.
 */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** One piece of printed JSON, colored by kind (design/components/ToolCall). */
export type JsonToken = {
  kind: 'key' | 'string' | 'literal' | 'punctuation'
  text: string
}

/**
 * Prints a JSON value on one line with a space after each `:` and `,` and inside braces
 * (`{ "query": "アラーム", "limit": 5 }`), as tokens to color. The text stays valid JSON, so
 * copying it gives JSON back. Values JSON cannot hold print as JSON.stringify prints them: an
 * object drops them, and anywhere else they print as `null`.
 */
export function jsonTokens(value: unknown): JsonToken[] {
  const tokens: JsonToken[] = []
  print(value, tokens)
  return tokens
}

function print(value: unknown, tokens: JsonToken[]): void {
  if (Array.isArray(value)) {
    // Array.from turns holes into undefined, which prints as null, as JSON.stringify does.
    printList('[', ']', Array.from(value), tokens, (item) => print(item, tokens))
    return
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, item]) => JSON.stringify(item) !== undefined)
    printList('{', '}', entries, tokens, ([key, item]) => {
      tokens.push({ kind: 'key', text: JSON.stringify(key) }, { kind: 'punctuation', text: ': ' })
      print(item, tokens)
    })
    return
  }
  const text = JSON.stringify(value) ?? 'null'
  tokens.push({ kind: typeof value === 'string' ? 'string' : 'literal', text })
}

function printList<T>(
  open: string,
  close: string,
  items: readonly T[],
  tokens: JsonToken[],
  printItem: (item: T) => void,
): void {
  if (items.length === 0) {
    tokens.push({ kind: 'punctuation', text: `${open}${close}` })
    return
  }
  const padding = open === '{' ? ' ' : ''
  tokens.push({ kind: 'punctuation', text: `${open}${padding}` })
  items.forEach((item, index) => {
    if (index > 0) tokens.push({ kind: 'punctuation', text: ', ' })
    printItem(item)
  })
  tokens.push({ kind: 'punctuation', text: `${padding}${close}` })
}
