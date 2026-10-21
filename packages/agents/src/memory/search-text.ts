/**
 * Japanese-aware search text for FTS5 with the `unicode61` tokenizer. The Worker segments text,
 * and FTS5 only splits on the spaces inserted here (docs/design/long-term-memory.md, Search text).
 */

/** Stored with every indexed row; rows of an older version are segmented again. */
export const SEARCH_VERSION = 1

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
const KATAKANA_WORD = /^[\p{Script=Katakana}ー]+$/u
/** サーバー and サーバ are the same word: drop a long-vowel mark after katakana. */
const LONG_VOWEL_AFTER_KATAKANA = /([ァ-ヴ])ー+/g

export type Words = { segments: string[]; merged: string[] }

/** Word-like segments, normalized; and the same with adjacent katakana segments merged. */
function words(text: string): Words {
  const segments: string[] = []
  const merged: string[] = []
  let previousWasKatakana = false
  for (const { segment, isWordLike } of segmenter.segment(text.normalize('NFKC').toLowerCase())) {
    if (!isWordLike) {
      previousWasKatakana = false
      continue
    }
    const word = segment.replace(LONG_VOWEL_AFTER_KATAKANA, '$1')
    const katakana = KATAKANA_WORD.test(word)
    segments.push(word)
    const last = merged.length - 1
    if (katakana && previousWasKatakana && last >= 0) merged[last] = `${merged[last]}${word}`
    else merged.push(word)
    previousWasKatakana = katakana
  }
  return { segments, merged }
}

/** The words of a query or of stored text: merged words and the original segments. */
export function searchWords(text: string): Words {
  return words(text)
}

/** Text for an indexed column: merged words, then the original segments that differ. */
export function storedSearchText(text: string): string {
  const { segments, merged } = words(text)
  const mergedWords = new Set(merged)
  return [...merged, ...segments.filter((segment) => !mergedWords.has(segment))].join(' ')
}

function quote(word: string): string {
  return `"${word.replaceAll('"', '""')}"`
}

/**
 * FTS5 MATCH expressions to try in order until one returns rows: merged words, the original
 * segments, then merged words as prefixes. Empty when the query has no word.
 */
export function searchQueries(query: string): string[] {
  const { segments, merged } = words(query)
  if (merged.length === 0) return []
  const all = (list: string[], prefix: boolean) =>
    list.map((word) => (prefix ? `${quote(word)}*` : quote(word))).join(' ')
  return [...new Set([all(merged, false), all(segments, false), all(merged, true)])]
}
