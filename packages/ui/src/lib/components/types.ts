/**
 * The data the Kodama components share: agent states, select options, sidebar rows, activity,
 * memories, tools, and peer senders. Kept in a TypeScript module so TypeScript files (and
 * type-aware Oxlint) can import them, which named exports from `.svelte` files do not allow.
 *
 * @module
 */

import type { AgentColor, AgentPose, AgentProp } from './avatar/avatar.js'

/** An agent's lifecycle or run state, as design/components/index.d.ts names it. */
export type RunState = 'live' | 'running' | 'queued' | 'paused' | 'error' | 'done' | 'archived'

/** The word each state shows when the caller passes no label. */
export const RUN_STATE_LABELS: Record<RunState, string> = {
  live: '稼働中',
  running: '実行中',
  queued: '待機中',
  paused: '一時停止',
  error: '失敗',
  done: '完了',
  archived: 'アーカイブ',
}

/** One choice in a Select; `group` puts it under a heading such as 最新 (Latest). */
export type SelectOption = {
  value: string
  label: string
  /** A second, muted line under the label. */
  hint?: string
  disabled?: boolean
  group?: string
}

/** The other agent a peer message came from (`kodama.agent-message`). */
export type PeerSender = {
  slug: string
  agentId: string
  /** How many agents the message passed through to get here. */
  hop: number
  avatar: { color: AgentColor; pose?: AgentPose }
}

/** One agent as the sidebar lists it. */
export type SidebarAgent = {
  agentId: string
  slug: string
  kind: 'working' | 'dedicated'
  status: RunState
  /** The face in the list; `prop` and `mark` show what it holds or wonders right now. */
  avatar: { color: AgentColor; pose: AgentPose; prop?: AgentProp | null; mark?: string }
  /** One line about the latest event. */
  latest: string
  /** ISO-8601 time of the latest event. */
  latestAt: string
  unread: number
}

/** One thing an agent did, newest first in the feed. */
export type ActivityItem = {
  /** ISO-8601 time. */
  at: string
  kind: 'alarm' | 'cron' | 'peer' | 'memory' | 'config' | 'run' | 'error'
  /** Bold: what happened, or who it was with. */
  subject: string
  /** Muted text after the subject. */
  detail?: string
  /** Still going: the running dot instead of the kind's icon. */
  active?: boolean
}

/** A remembered item, with where it came from. */
export type MemoryItem = {
  kind: '事実' | '好み' | '手順'
  text: string
  /** Who it came from: an agent's slug, or あなた (you). */
  source: string
  /** ISO-8601 time. */
  at: string
}

/** A tool the agent may use. */
export type AgentTool = {
  name: string
  description: string
  enabled: boolean
  /** Managed by the system: shown, but its switch is disabled. */
  locked?: boolean
}
