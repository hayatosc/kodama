<script lang="ts">
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SearchIcon from '@lucide/svelte/icons/search'
  import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal'
  import { RUN_STATE_LABELS, type RunState, type SidebarAgent } from '../types.js'
  import UnreadCount from '../UnreadCount.svelte'
  import { AgentAvatar } from '../avatar/index.js'
  import { Button } from '../ui/button/index.js'
  import { cn, focusRing } from '#lib/utils.js'
  import { relativeTime, sortAgents } from './format.js'

  let {
    main,
    agents,
    system,
    currentSlug,
    user,
    now = new Date(),
    onselect,
    onsearch,
    oncreate,
    onsettings,
    mobile = false,
    class: className,
  }: {
    /** The main agent, in the large row at the top. */
    main: SidebarAgent
    /** The other working agents; the sidebar puts running ones first, then the most recent. */
    agents: SidebarAgent[]
    /** Dedicated agents, under システム (System) in gray. */
    system: SidebarAgent[]
    currentSlug?: string
    /** The signed-in user, at the bottom. */
    user: { name: string }
    /** The time the list is read at, for relative times. */
    now?: Date
    onselect?: (slug: string) => void
    onsearch?: () => void
    oncreate?: () => void
    onsettings?: () => void
    /** The phone's list screen: a Kodama heading, 40px avatars, full width, no account row. */
    mobile?: boolean
    class?: string
  } = $props()

  const ordered = $derived(sortAgents(agents))

  /** The state word's color in the main row: only the three status colors get one. */
  function stateColor(status: RunState): string {
    if (status === 'running') return 'text-running'
    if (status === 'live') return 'text-live'
    if (status === 'error') return 'text-destructive'
    return ''
  }

  /** Rows sit on the sidebar; hover is accent, selected is muted, and the avatar badge's ring follows. */
  const rowClass = cn(
    'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left text-foreground',
    '[--badge-ring:var(--sidebar)] hover:bg-accent hover:[--badge-ring:var(--accent)]',
    'aria-[current=page]:bg-muted aria-[current=page]:[--badge-ring:var(--muted)]',
    focusRing,
  )
</script>

{#snippet row(agent: SidebarAgent)}
  {@const dedicated = agent.kind === 'dedicated'}
  <li>
    <button
      type="button"
      class={rowClass}
      aria-current={agent.slug === currentSlug ? 'page' : undefined}
      onclick={() => onselect?.(agent.slug)}
    >
      <AgentAvatar
        color={dedicated ? 'system' : agent.avatar.color}
        pose={agent.avatar.pose}
        size={mobile ? 40 : 36}
        badge={!dedicated}
      />
      <span class="min-w-0 flex-1">
        <span class="flex items-baseline gap-2">
          <span class={cn('flex-1 truncate font-semibold', dedicated && 'font-mono text-sm')}
            >{agent.slug}</span
          >
          {#if agent.unread > 0}
            <UnreadCount count={agent.unread} />
          {:else}
            <span class="text-xs text-muted-foreground"
              >{relativeTime(new Date(agent.latestAt), now)}</span
            >
          {/if}
        </span>
        <span class="block truncate text-sm text-muted-foreground">{agent.latest}</span>
      </span>
    </button>
  </li>
{/snippet}

<nav
  class={cn(
    'flex h-full flex-col gap-0.5 p-3',
    mobile ? 'w-full bg-background' : 'w-[280px] bg-sidebar',
    className,
  )}
  aria-label="エージェント"
>
  <div class="flex items-center justify-end gap-2 pb-2">
    {#if mobile}
      <h1 class="mr-auto pl-2 font-display text-[28px] leading-9 font-semibold">Kodama</h1>
    {/if}
    <Button size="circle" aria-label="検索" onclick={onsearch}
      ><SearchIcon strokeWidth={1.75} /></Button
    >
    <Button size="circle" aria-label="新しいエージェント" onclick={oncreate}>
      <PlusIcon strokeWidth={1.75} />
    </Button>
  </div>

  <button
    type="button"
    class={cn(rowClass, 'mb-1')}
    aria-current={main.slug === currentSlug ? 'page' : undefined}
    onclick={() => onselect?.(main.slug)}
  >
    <AgentAvatar color={main.avatar.color} pose={main.avatar.pose} size={56} />
    <span class="min-w-0 flex-1">
      <span class="block text-xs text-muted-foreground">メイン</span>
      <span class="type-lg block truncate">{main.slug}</span>
      <span class="block truncate text-sm text-muted-foreground">
        <span class={stateColor(main.status)}>{RUN_STATE_LABELS[main.status]}</span> · {main.latest}
      </span>
    </span>
  </button>

  <h2 class="px-3 pt-3 pb-1 text-xs text-muted-foreground">エージェント</h2>
  <ul class="flex flex-col gap-0.5">
    {#each ordered as agent (agent.agentId)}
      {@render row(agent)}
    {/each}
  </ul>

  {#if system.length > 0}
    <h2 class="px-3 pt-3 pb-1 text-xs text-muted-foreground">システム</h2>
    <ul class="flex flex-col gap-0.5">
      {#each system as agent (agent.agentId)}
        {@render row(agent)}
      {/each}
    </ul>
  {/if}

  {#if !mobile}
    <div class="mt-auto flex items-center gap-3 px-1 pt-2">
      <span
        class="grid size-8 place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground"
        aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span
      >
      <span class="flex-1 truncate font-semibold">{user.name}</span>
      <Button variant="ghost" size="icon" aria-label="設定" onclick={onsettings}>
        <SlidersHorizontalIcon strokeWidth={1.75} />
      </Button>
    </div>
  {/if}
</nav>
