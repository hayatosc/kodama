<script lang="ts">
  import { ArrowLeftRight, BookOpen, CalendarClock, Clock } from '@lucide/svelte'
  import { cn } from '#shared/lib/utils.js'
  import { formatActivityTime, type ActivityItem, type ActivityKind } from '../model/activity.js'
  import type { Component } from 'svelte'

  let {
    items,
    compact = false,
    now = new Date(),
    class: className,
  }: {
    /** Newest first. */
    items: readonly ActivityItem[]
    /** The right pane's narrower form: a 44px time column and 14px text. */
    compact?: boolean
    /** The time the feed's times are written against; mock data passes a fixed one. */
    now?: Date
    class?: string
  } = $props()

  /** Kinds drawn as a 16px icon; the rest are a dot. */
  const icons: Partial<Record<ActivityKind, Component>> = {
    alarm: Clock,
    cron: CalendarClock,
    peer: ArrowLeftRight,
    memory: BookOpen,
  }
</script>

<!--
  design/components/ActivityFeed: a timeline, newest first. Each row is a right-aligned time, a
  node on a 1px line, and the body: the subject in bold and the detail muted. An event still in
  progress has the running dot, and says so to screen readers; a failure has the destructive dot
  and subject.
-->
<ol data-slot="activity-feed" class={cn('feed', compact && 'compact', className)}>
  {#each items as item (item.id)}
    {@const Icon = icons[item.kind]}
    <li>
      <time datetime={item.at}>{formatActivityTime(item.at, now)}</time>
      <span class="node" aria-hidden="true">
        {#if item.active}
          <span class="dot running bg-running"></span>
        {:else if item.kind === 'error'}
          <span class="dot bg-destructive"></span>
        {:else if Icon}
          <Icon class="size-4 text-muted-foreground" strokeWidth={1.75} />
        {:else}
          <span class="dot bg-muted-foreground"></span>
        {/if}
      </span>
      <span class="min-w-0">
        <strong
          class={cn('font-semibold text-foreground', item.kind === 'error' && 'text-destructive')}
          >{item.subject}</strong
        >
        {#if item.detail}<span class="text-muted-foreground">{item.detail}</span>{/if}
        {#if item.active}<span class="sr-only">（進行中）</span>{/if}
      </span>
    </li>
  {/each}
</ol>

<style>
  .feed {
    --time-column: 52px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 16px;
    line-height: 24px;
  }

  .compact {
    --time-column: 44px;
    font-size: 14px;
  }

  li {
    position: relative;
    display: grid;
    grid-template-columns: var(--time-column) 16px minmax(0, 1fr);
    column-gap: var(--spacing-3);
    align-items: start;
    padding-block: 6px;
  }

  .compact li {
    padding-block: 4px;
  }

  /* The line through the nodes, from the first node to the last. */
  li::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: calc(var(--time-column) + var(--spacing-3) + 7.5px);
    inline-size: 1px;
    background: var(--border);
  }

  li:first-child::before {
    inset-block-start: 14px;
  }

  li:last-child::before {
    inset-block-end: calc(100% - 14px);
  }

  time {
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 24px;
    text-align: end;
    color: var(--muted-foreground);
  }

  /* The node covers the line with the page's own background. */
  .node {
    position: relative;
    z-index: 1;
    display: grid;
    place-items: center;
    inline-size: 16px;
    block-size: 24px;
    background: var(--background);
  }

  .dot {
    inline-size: 8px;
    block-size: 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-full);
  }

  @media (prefers-reduced-motion: no-preference) {
    .running {
      animation: pulse 1.6s ease-in-out infinite;
    }
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  @media (forced-colors: active) {
    li::before {
      background: CanvasText;
    }
  }
</style>
