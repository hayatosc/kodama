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

  /** A node's dot; the transparent border is what forced colors mode draws. */
  const dot = 'size-2 rounded-full border border-transparent'
</script>

<!--
  design/components/ActivityFeed: a timeline, newest first. Each row is a right-aligned time, a
  node on a 1px line, and the body: the subject in bold and the detail muted. An event still in
  progress has the running dot, and says so to screen readers; a failure has the destructive dot
  and subject.
-->
<ol
  data-slot="activity-feed"
  class={cn(
    'm-0 list-none p-0',
    compact ? 'text-sm [--time-column:44px]' : 'text-base [--time-column:52px]',
    'leading-6',
    className,
  )}
>
  {#each items as item (item.id)}
    {@const Icon = icons[item.kind]}
    <!-- The ::before line runs through the nodes, from the first node to the last. -->
    <li
      class={[
        'relative grid grid-cols-[var(--time-column)_16px_minmax(0,1fr)] items-start gap-x-3',
        'before:absolute before:inset-y-0 before:start-[calc(var(--time-column)+--spacing(5))] before:w-px before:-translate-x-1/2 before:bg-border rtl:before:translate-x-1/2 first:before:top-3.5 last:before:bottom-auto last:before:h-3.5 first:last:before:hidden forced-colors:before:bg-[CanvasText]',
        compact ? 'py-1' : 'py-1.5',
      ]}
    >
      <time datetime={item.at} class="text-end font-mono text-xs leading-6 text-muted-foreground"
        >{formatActivityTime(item.at, now)}</time
      >
      <!-- The node covers the line with the page's own background. -->
      <span class="relative z-1 grid h-6 w-4 place-items-center bg-background" aria-hidden="true">
        {#if item.active}
          <span class={[dot, 'bg-running motion-safe:animate-running']}></span>
        {:else if item.kind === 'error'}
          <span class={[dot, 'bg-destructive']}></span>
        {:else if Icon}
          <Icon class="size-4 text-muted-foreground" strokeWidth={1.75} />
        {:else}
          <span class={[dot, 'bg-muted-foreground']}></span>
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
