<script lang="ts">
  import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right'
  import BookOpenIcon from '@lucide/svelte/icons/book-open'
  import ClockIcon from '@lucide/svelte/icons/clock'
  import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal'
  import { cn } from '#lib/utils.js'
  import type { ActivityItem } from '../types.js'
  import { activityTime } from './format.js'

  let {
    items,
    compact = false,
    now = new Date(),
    class: className,
  }: {
    items: ActivityItem[]
    /** The right pane's version: a 44px time column and smaller text. */
    compact?: boolean
    /** The time the feed is read at, which decides 09:00, 昨日, or 10/28. */
    now?: Date
    class?: string
  } = $props()

  /** The node icon for a finished event: clock, arrows for another agent, book, or sliders. */
  function iconOf(kind: ActivityItem['kind']) {
    if (kind === 'alarm' || kind === 'cron') return ClockIcon
    if (kind === 'peer') return ArrowLeftRightIcon
    if (kind === 'memory') return BookOpenIcon
    if (kind === 'config') return SlidersHorizontalIcon
    return undefined
  }
</script>

<ol class={cn('feed', compact && 'compact', className)}>
  {#each items as item, index (index)}
    {@const Icon = iconOf(item.kind)}
    <li>
      <time datetime={item.at}>{activityTime(new Date(item.at), now)}</time>
      <span class="node">
        {#if item.active}
          <span class="size-2 animate-blink rounded-full bg-running motion-reduce:animate-none"
          ></span>
        {:else if item.kind === 'error'}
          <span class="size-2 rounded-full bg-destructive"></span>
        {:else if Icon}
          <Icon class="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        {:else}
          <span class="size-2 rounded-full bg-muted-foreground"></span>
        {/if}
      </span>
      <span>
        <strong class={item.kind === 'error' ? 'text-destructive' : 'text-foreground'}
          >{item.subject}</strong
        >
        {#if item.detail}<span class="text-muted-foreground">{item.detail}</span>{/if}
      </span>
    </li>
  {/each}
</ol>

<style>
  .feed {
    --time: 52px;
  }
  .feed.compact {
    --time: 44px;
  }
  li {
    position: relative;
    display: grid;
    grid-template-columns: var(--time) 16px 1fr;
    column-gap: 12px;
    align-items: start;
    padding: 6px 0;
    font-size: 16px;
    line-height: 24px;
  }
  .compact li {
    padding: 4px 0;
    font-size: 14px;
  }
  /* The vertical line through the nodes, from the first node to the last. */
  li::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--time) + 12px + 7.5px);
    width: 1px;
    background: var(--border);
  }
  li:first-child::before {
    top: 14px;
  }
  li:last-child::before {
    bottom: calc(100% - 14px);
  }
  time {
    font: 12px/24px var(--font-mono);
    color: var(--muted-foreground);
    text-align: right;
  }
  .node {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 16px;
    height: 20px;
    margin-top: 2px;
    background: var(--feed-surface, var(--background));
  }
  strong {
    font-weight: 600;
  }
</style>
