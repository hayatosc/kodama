<script lang="ts">
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import InfoIcon from '@lucide/svelte/icons/info'
  import { AgentAvatar, type AgentColor, type AgentPose } from '../avatar/index.js'
  import { RUN_STATE_LABELS, type RunState } from '../types.js'
  import { Button } from '../ui/button/index.js'

  let {
    agent,
    onback,
    ondetails,
  }: {
    agent: {
      slug: string
      avatar: { color: AgentColor; pose: AgentPose }
      status: RunState
      /** What it is doing now, after the state word. */
      activity?: string
    }
    onback: () => void
    ondetails: () => void
  } = $props()

  const stateColor = $derived(
    agent.status === 'running'
      ? 'text-running'
      : agent.status === 'live'
        ? 'text-live'
        : agent.status === 'error'
          ? 'text-destructive'
          : '',
  )
</script>

<!-- design/components/Mobile: a 56px bar above the conversation. -->
<header class="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2">
  <Button variant="ghost" size="icon" aria-label="戻る" onclick={onback}>
    <ChevronLeftIcon strokeWidth={1.75} />
  </Button>
  <AgentAvatar color={agent.avatar.color} pose={agent.avatar.pose} size={32} />
  <div class="flex min-w-0 flex-1 flex-col">
    <h1 class="truncate text-base leading-6 font-semibold">{agent.slug}</h1>
    <p class="truncate text-xs text-muted-foreground">
      <span class={stateColor}>{RUN_STATE_LABELS[agent.status]}</span>{agent.activity
        ? ` · ${agent.activity}`
        : ''}
    </p>
  </div>
  <Button variant="ghost" size="icon" aria-label="詳細" onclick={ondetails}>
    <InfoIcon strokeWidth={1.75} />
  </Button>
</header>
