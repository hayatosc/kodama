/**
 * Text formatting for the conversation parts: JSON tokens for tool arguments and durations.
 *
 * @module
 */

/** One piece of highlighted JSON: a key, a string, a number, a literal, or punctuation. */
export type JsonToken = { kind: 'key' | 'string' | 'number' | 'literal' | 'plain'; text: string }

/** Values short enough to read on one line, as `{ "query": "アラーム" }`. */
const ONE_LINE_LIMIT = 60

const TOKEN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]|\s+/g

/** Joins neighbouring plain tokens, so the result reads as a few spans rather than many. */
function push(tokens: JsonToken[], token: JsonToken): void {
  const last = tokens.at(-1)
  if (token.kind === 'plain' && last?.kind === 'plain') last.text += token.text
  else tokens.push(token)
}

/**
 * Splits a value's JSON into tokens for ToolCall's colors (keys in live, strings in running,
 * numbers in destructive). Short values stay on one line with spaces after `{`, `:`, and `,`;
 * longer ones are indented by two spaces.
 */
export function jsonTokens(value: unknown): JsonToken[] {
  const compact = JSON.stringify(value)
  if (compact === undefined) return [{ kind: 'plain', text: String(value) }]
  const oneLine = compact.length <= ONE_LINE_LIMIT
  const text = oneLine ? compact : JSON.stringify(value, null, 2)
  const matches = [...text.matchAll(TOKEN)].map((match) => match[0])
  const tokens: JsonToken[] = []
  matches.forEach((raw, index) => {
    if (raw.startsWith('"')) {
      const next = matches.slice(index + 1).find((later) => later.trim() !== '')
      push(tokens, { kind: next === ':' ? 'key' : 'string', text: raw })
    } else if (raw === 'true' || raw === 'false' || raw === 'null') {
      push(tokens, { kind: 'literal', text: raw })
    } else if (/^-?\d/.test(raw)) {
      push(tokens, { kind: 'number', text: raw })
    } else if (oneLine && (raw === ':' || raw === ',')) {
      push(tokens, { kind: 'plain', text: `${raw} ` })
    } else if (oneLine && (raw === '{' || raw === '[') && compact.length > 2) {
      push(tokens, { kind: 'plain', text: `${raw} ` })
    } else if (oneLine && (raw === '}' || raw === ']') && compact.length > 2) {
      push(tokens, { kind: 'plain', text: ` ${raw}` })
    } else {
      push(tokens, { kind: 'plain', text: raw })
    }
  })
  return tokens
}

/** A duration as the tool row shows it: `0.4s` under ten seconds, `38s`, then `2m 05s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`
}
