/**
 * An agent's run state as the UI shows it: the word for each state and how a registry lifecycle
 * state maps onto one (design/components/StatusBadge).
 *
 * @module
 */

/** Every run state, in the order the stories show them. */
export const RUN_STATES = [
  'live',
  'running',
  'queued',
  'paused',
  'error',
  'done',
  'archived',
] as const

/** What an agent is doing now, shown by a dot's color and shape and a word. */
export type RunState = (typeof RUN_STATES)[number]

/** The word each state shows when the caller passes no label. */
export const STATUS_WORDS: Record<RunState, string> = {
  live: '稼働中',
  running: '実行中',
  queued: '待機中',
  paused: '一時停止',
  error: '失敗',
  done: '完了',
  archived: 'アーカイブ',
}

/**
 * A registry lifecycle state, as `AgentStatus` in packages/agents/src/protocol.ts names it. It is
 * repeated here because the UI reaches the agents only through RPC and imports none of its code.
 */
export type AgentLifecycle =
  | 'provisioning'
  | 'active'
  | 'pausing'
  | 'paused'
  | 'archived'
  | 'deleting'
  | 'deleted'

/** The run state a lifecycle state shows as (design/components/StatusBadge — the mapping). */
export function runStateOf(lifecycle: AgentLifecycle): RunState {
  switch (lifecycle) {
    case 'active':
      return 'live'
    case 'provisioning':
    case 'pausing':
      return 'running'
    case 'paused':
      return 'paused'
    case 'archived':
    case 'deleted':
      return 'archived'
    case 'deleting':
      return 'error'
  }
}
