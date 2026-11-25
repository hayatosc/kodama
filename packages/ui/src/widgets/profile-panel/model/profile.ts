/**
 * What the profile panel shows about an agent: its routines, its memories, and its tools.
 *
 * @module
 */

import type { AgentColor, AgentPose, RunState } from '#entities/agent/index.js'

/** The agent the panel is about. */
export type ProfileAgent = {
  slug: string
  status: RunState
  avatar: { color: AgentColor; pose: AgentPose }
}

/** A cron routine, such as 「毎朝のまとめ」 at 「09:00 毎日」. */
export type Routine = { id: string; name: string; schedule: string }

/** What a memory records (design/components/Tabs — Memory). */
export type MemoryKind = 'fact' | 'preference' | 'procedure'

/** The badge word for each memory kind. */
export const MEMORY_KIND_WORDS: Record<MemoryKind, string> = {
  fact: '事実',
  preference: '好み',
  procedure: '手順',
}

/** One remembered item. */
export type MemoryItem = {
  id: string
  kind: MemoryKind
  text: string
  /** Who it came from: an agent's slug, or 「あなた」. */
  source: string
  /** When it was recorded, as an ISO-8601 time. */
  at: string
}

/** One tool the agent may use. */
export type AgentTool = {
  name: string
  description: string
  enabled: boolean
  /** Managed by the system: shown, but its switch cannot be changed. */
  locked?: boolean
}

/** A memory's date as the list writes it, such as `10/30`, in the device's time zone. */
export function formatMemoryDate(at: string): string {
  const date = new Date(at)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * The memories whose text or source contains the query, ignoring case and surrounding spaces;
 * all of them for an empty query.
 */
export function filterMemories(memories: readonly MemoryItem[], query: string): MemoryItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...memories]
  return memories.filter(
    (memory) =>
      memory.text.toLowerCase().includes(needle) || memory.source.toLowerCase().includes(needle),
  )
}
