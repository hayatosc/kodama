<script lang="ts">
  import { Plus, Search, Settings } from '@lucide/svelte'
  import { AgentAvatar, STATUS_WORDS, type RunState } from '#entities/agent/index.js'
  import { Button } from '#shared/ui/button/index.js'
  import { cn, focusRing } from '#shared/lib/utils.js'
  import {
    formatRelativeTime,
    formatUnread,
    sortAgents,
    type SidebarAgent,
  } from '../model/sidebar.js'

  let {
    main,
    agents,
    system,
    currentSlug,
    account,
    onselect,
    now = new Date(),
    class: className,
  }: {
    /** The main agent, in the slot at the top. */
    main: SidebarAgent
    /** The other working agents; the sidebar orders them. */
    agents: readonly SidebarAgent[]
    /** The dedicated agents, under 「システム」. */
    system: readonly SidebarAgent[]
    /** The agent on screen, marked as the current one. */
    currentSlug?: string
    /** The signed-in user, at the bottom. */
    account: { name: string }
    /** Called with the agent's slug when its row is chosen. */
    onselect?: (slug: string) => void
    /** The time rows write their times against; mock data passes a fixed one. */
    now?: Date
    class?: string
  } = $props()

  const workingAgents = $derived(sortAgents(agents))
  const systemAgents = $derived(sortAgents(system))

  /** The color of the state word in the main row; the word itself always shows. */
  const stateColor: Partial<Record<RunState, string>> = {
    live: 'text-live',
    running: 'text-running',
    error: 'text-destructive',
  }

  const rowLink = cn(
    'flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-start text-foreground transition-colors duration-[120ms] hover:bg-accent aria-[current=true]:bg-muted',
    focusRing,
  )
</script>

<!--
  design/components/Sidebar: the agent list in the left pane, 280px wide on the sidebar surface.
  The main agent sits in the slot at the top, then the working agents, then the dedicated ones
  under 「システム」. Each row is a button that chooses its agent, marked with aria-current while
  that agent is on screen; it becomes a link once the app has a route for each agent. A row's
  state is told by its avatar and named for screen readers.
-->
<nav
  aria-label="エージェント"
  data-slot="sidebar"
  class={cn('flex h-full w-[280px] flex-col gap-0.5 bg-sidebar p-3', className)}
>
  <div class="flex justify-end gap-2 pb-2">
    <Button variant="secondary" size="icon-sm" class="rounded-full bg-background" aria-label="検索">
      <Search aria-hidden="true" strokeWidth={1.75} />
    </Button>
    <Button
      variant="secondary"
      size="icon-sm"
      class="rounded-full bg-background"
      aria-label="新しいエージェント"
    >
      <Plus aria-hidden="true" strokeWidth={1.75} />
    </Button>
  </div>

  <button
    type="button"
    aria-current={main.slug === currentSlug ? 'true' : undefined}
    class={cn(rowLink, 'mb-1')}
    onclick={() => onselect?.(main.slug)}
  >
    <AgentAvatar color={main.avatar.color} pose={main.avatar.pose} size={56} />
    <span class="min-w-0 flex-1">
      <span class="block text-xs text-muted-foreground">メイン</span>
      <span class="block truncate font-display text-lg leading-7 font-semibold tracking-[-0.01em]"
        >{main.slug}</span
      >
      <span class="block truncate text-sm text-muted-foreground"
        ><span class={stateColor[main.status]}>{STATUS_WORDS[main.status]}</span> · {main.latest}</span
      >
    </span>
  </button>

  {#snippet section(heading: string, list: readonly SidebarAgent[], dedicated: boolean)}
    <h2 class="px-3 pt-3 pb-1 text-xs font-normal text-muted-foreground">{heading}</h2>
    <ul class="flex flex-col gap-0.5">
      {#each list as agent (agent.agentId)}
        <li>
          <button
            type="button"
            aria-current={agent.slug === currentSlug ? 'true' : undefined}
            class={rowLink}
            onclick={() => onselect?.(agent.slug)}
          >
            <AgentAvatar
              color={dedicated ? 'system' : agent.avatar.color}
              pose={agent.avatar.pose}
              size={36}
              badge={!dedicated}
            />
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline gap-2">
                <span
                  class={cn(
                    'min-w-0 flex-1 truncate font-semibold',
                    dedicated && 'font-mono text-sm',
                  )}>{agent.slug}</span
                >
                {#if agent.unread > 0}
                  <span
                    class="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center self-center rounded-full border border-transparent bg-live px-[5px] text-[11px] font-semibold text-primary-foreground"
                    ><span class="sr-only">未読 </span>{formatUnread(agent.unread)}<span
                      class="sr-only">件</span
                    ></span
                  >
                {:else}
                  <time datetime={agent.latestAt} class="shrink-0 text-xs text-muted-foreground"
                    >{formatRelativeTime(agent.latestAt, now)}</time
                  >
                {/if}
              </span>
              <span class="block truncate text-sm text-muted-foreground"
                ><span class="sr-only">{STATUS_WORDS[agent.status]}: </span>{agent.latest}</span
              >
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/snippet}

  {@render section('エージェント', workingAgents, false)}
  {#if systemAgents.length > 0}
    {@render section('システム', systemAgents, true)}
  {/if}

  <div class="mt-auto flex items-center gap-3 px-1 pt-2">
    <span
      class="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-muted-foreground"
      aria-hidden="true">{account.name.slice(0, 1).toUpperCase()}</span
    >
    <span class="min-w-0 flex-1 truncate font-semibold">{account.name}</span>
    <Button variant="ghost" size="icon" aria-label="設定">
      <Settings aria-hidden="true" strokeWidth={1.75} />
    </Button>
  </div>
</nav>
