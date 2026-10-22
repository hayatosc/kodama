/**
 * Japanese-aware search words for the `memory_terms` index and the archive index. The Worker
 * segments text with `Intl.Segmenter`.
 *
 * @see docs/memory.md — Search text
 *
 * @module
 */

/** Stored with every indexed row; rows of an older version are segmented again. */
export const SEARCH_VERSION = 1

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' })
const KATAKANA_WORD = /^[\p{Script=Katakana}ー]+$/u
/** サーバー and サーバ are the same word: drop a long-vowel mark after katakana. */
const LONG_VOWEL_AFTER_KATAKANA = /([ァ-ヴ])ー+/g

/**
 * The words of a text: `segments` as the segmenter split them, and `merged` with adjacent katakana
 * segments joined into one word.
 */
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

/** The distinct words a record is indexed under. */
export function storedTerms(text: string): string[] {
  return [...new Set(storedSearchText(text).split(' '))].filter((term) => term.length > 0)
}

/** One word set a search tries; a record matches when it has every term. */
export interface TermSet {
  terms: string[]
  /** Match terms that start with each word. */
  prefix: boolean
}

/**
 * Word sets to try in order until one matches: merged words, the original segments, then merged
 * words as prefixes. A record matches a set when it has every word. Empty without a word.
 */
export function searchTermSets(query: string): TermSet[] {
  const { segments, merged } = words(query)
  if (merged.length === 0) return []
  const sets: TermSet[] = [{ terms: [...new Set(merged)], prefix: false }]
  const segmentTerms = [...new Set(segments)]
  if (segmentTerms.join(' ') !== sets[0]?.terms.join(' '))
    sets.push({ terms: segmentTerms, prefix: false })
  sets.push({ terms: [...new Set(merged)], prefix: true })
  return sets
}
