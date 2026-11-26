/**
 * Checks the memory search and the memory date.
 *
 * @module
 */

import { describe, expect, test } from 'vite-plus/test'
import { filterMemories, formatMemoryDate, type MemoryItem } from './profile.js'

const memories: MemoryItem[] = [
  {
    id: '1',
    kind: 'fact',
    text: '発表は 11/7（木）',
    source: 'research',
    at: '2026-10-30T03:00:00Z',
  },
  {
    id: '2',
    kind: 'preference',
    text: '出典の URL を付ける',
    source: 'あなた',
    at: '2026-10-28T03:00:00Z',
  },
]

describe('filterMemories', () => {
  test('matches the text or the source, ignoring case and spaces', () => {
    expect(filterMemories(memories, '  url ').map((memory) => memory.id)).toEqual(['2'])
    expect(filterMemories(memories, 'Research').map((memory) => memory.id)).toEqual(['1'])
    expect(filterMemories(memories, '')).toHaveLength(2)
    expect(filterMemories(memories, '会議')).toEqual([])
  })
})

describe('formatMemoryDate', () => {
  test('writes the month and day', () => {
    expect(formatMemoryDate(new Date(2026, 9, 30, 12).toISOString())).toBe('10/30')
  })
})
