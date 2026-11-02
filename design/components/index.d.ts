// Kodama component props, written as Svelte 5 $props() shapes. Documentation only.

export type RunState = 'live' | 'running' | 'queued' | 'paused' | 'error' | 'done' | 'archived'

export type AgentColor =
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'sky'
  | 'blue'
  | 'violet'
  | 'plum'
  | 'pink'
  | 'red'
  | 'brown'
  | 'ink'
  | 'system'
export type AgentPose =
  | 'idle'
  | 'listen'
  | 'work'
  | 'write'
  | 'happy'
  | 'live'
  | 'tilt'
  | 'surprised'
  | 'sleep'
  | 'stretch'
  | 'paused'
  | 'worried'
  | 'error'

export type AgentProp = 'lens' | 'pen' | 'letter'

export interface AgentAvatarProps {
  /** 'ink' is reserved for the main agent, 'system' for dedicated agents. */
  color: AgentColor
  /** Derived from the event stream; sleep and paused draw the birdhouse instead of the bird. */
  pose?: AgentPose
  /** Defaults by pose (work holds a lens, write holds a pen over a sheet). Dropped at 20px. */
  prop?: AgentProp
  /** '?' or '!', shown above the head. */
  mark?: string
  size?: 20 | 36 | 56 | 72
  /** Hidden automatically at 20px. */
  badge?: boolean
}

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive'
  size?: 'default' | 'sm' | 'icon' | 'round' | 'circle' | 'chip'
  disabled?: boolean
  /** Required when the button shows only an icon. */
  'aria-label'?: string
  onclick?: (event: MouseEvent) => void
}

export interface StatusBadgeProps {
  status: RunState
  /** Defaults to the Japanese word for the status (稼働中, 実行中, …). */
  label?: string
  /** Dot only, for sidebar rows. */
  dotOnly?: boolean
}

export interface SidebarAgent {
  agentId: string
  slug: string
  kind: 'working' | 'dedicated'
  status: RunState
  avatar: { color: AgentColor; pose: AgentPose }
  /** One-line summary of the latest event. */
  latest: string
  /** ISO-8601 time of the latest event. */
  latestAt: string
  unread: number
}

export interface SidebarProps {
  /** Shown in the featured slot at the top. */
  main: SidebarAgent
  agents: SidebarAgent[]
  system: SidebarAgent[]
  currentSlug?: string
}

export interface MessageProps {
  role: 'user' | 'assistant' | 'thinking' | 'peer'
  /** Rendered Markdown. */
  html: string
  streaming?: boolean
  /** Present for role = 'peer'. */
  from?: { slug: string; agentId: string; hop: number; at: string; avatar: AgentAvatarProps }
}

export interface ComposerProps {
  agentName: string
  running: boolean
  /** Messages waiting to be sent when the current run ends (added with Tab). */
  queue: string[]
  /** Enter: send now; while running this interrupts the run (steering). */
  onsend: (text: string) => void
  /** Tab while running (a button on phones): add to the queue (follow-up). */
  onqueue: (text: string) => void
  onremove: (index: number) => void
  oncancel: () => void
  /** Phones have no Tab key: the sheet shows a 「キューに追加」 button instead of the hint. */
  mobile?: boolean
}

/** Bottom sheet for phones: the profile panel opened from the app bar. */
export interface SheetProps {
  open: boolean
  label: string
  onclose: () => void
}

/** Phone app bar above a conversation. */
export interface AppBarProps {
  agent: { slug: string; avatar: AgentAvatarProps; state: string; activity?: string }
  onback: () => void
  ondetails: () => void
}

export interface ActivityItem {
  at: string
  kind: 'alarm' | 'cron' | 'peer' | 'memory' | 'config' | 'run' | 'error'
  subject: string
  detail?: string
  active?: boolean
}

export interface ActivityFeedProps {
  items: ActivityItem[]
  compact?: boolean
}

export interface ProfilePanelProps {
  agent: { slug: string; status: RunState; avatar: AgentAvatarProps }
  routines: { name: string; schedule: string }[]
  nextAlarm?: string
  model: string
  models: string[]
  provider: string
  providers: string[]
  activity: ActivityItem[]
  tab?: 'details' | 'memory' | 'tools'
}

export interface ToolCallProps {
  name: string
  summary: string
  state: 'running' | 'done' | 'error'
  durationMs?: number
  /** JSON arguments, shown highlighted when open. */
  args?: unknown
  result?: string
  /** e.g. "5 件" or "2.4 KB", shown in the result header. */
  resultSize?: string
  error?: string
  open?: boolean
}

export interface TabsProps {
  value: 'details' | 'memory' | 'tools'
  onchange: (value: 'details' | 'memory' | 'tools') => void
}

export interface MemoryItem {
  kind: '事実' | '好み' | '手順'
  text: string
  source: string
  at: string
}

export interface AgentTool {
  name: string
  description: string
  enabled: boolean
  /** Managed by the system: shown, but the switch is disabled. */
  locked?: boolean
}

export interface SelectOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
  group?: string
}

export interface SelectProps {
  options: SelectOption[]
  value: string
  onchange: (value: string) => void
  /** 'field' has a border (forms); 'inline' is borderless for settings rows. */
  /** Show a search field (lists longer than 8 options, e.g. models). */
  searchable?: boolean
  variant?: 'field' | 'inline'
}

export interface SwitchProps {
  checked: boolean
  disabled?: boolean
  onchange: (checked: boolean) => void
  'aria-label'?: string
}

export interface SettingsRow {
  label: string
  hint?: string
  kind: 'value' | 'select' | 'switch' | 'danger'
}

export interface DialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onconfirm: () => void
  oncancel: () => void
}

export interface KbdProps {
  keys: string
}
