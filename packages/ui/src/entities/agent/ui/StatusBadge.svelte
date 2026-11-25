<script lang="ts">
  import { badgeVariants, type BadgeVariant } from '#shared/ui/badge/index.js'
  import { cn } from '#shared/lib/utils.js'
  import { STATUS_WORDS, type RunState } from '../model/status.js'

  let {
    status,
    label,
    dotOnly = false,
    class: className,
  }: {
    status: RunState
    /** Replaces the state's word, such as 「返事待ち」 for an unanswered submission. */
    label?: string
    /** Only the dot, for list rows; the word is still read by screen readers. */
    dotOnly?: boolean
    class?: string
  } = $props()

  const word = $derived(label ?? STATUS_WORDS[status])

  const variants: Record<RunState, BadgeVariant> = {
    live: 'live',
    running: 'running',
    queued: 'neutral',
    paused: 'neutral',
    error: 'destructive',
    done: 'neutral',
    archived: 'neutral',
  }

  /**
   * The dot's color and shape: filled for live, running, error, and the finished states; a hollow
   * circle while queued; a hollow square while paused. The shape and the word always come with
   * the color, so no state is told by color alone.
   */
  const dots: Record<RunState, string> = {
    live: 'bg-live',
    running: 'running bg-running',
    queued: 'border-[1.5px] border-muted-foreground',
    paused: 'rounded-[2px] border-[1.5px] border-muted-foreground',
    error: 'bg-destructive',
    done: 'bg-muted-foreground',
    archived: 'bg-muted-foreground',
  }
</script>

<!--
  design/components/StatusBadge: a dot and a word. Pane headings and the profile panel show the
  badge; list rows show the dot alone, with the word kept for screen readers. The running dot
  blinks, and holds still under a reduced-motion request. Filled dots carry a transparent border,
  which forced colors mode draws, so every dot keeps its shape there.
-->
{#snippet dot()}
  <span
    data-status={status}
    class={cn('size-2 shrink-0 rounded-full border border-transparent', dots[status])}
    aria-hidden="true"
  ></span>
{/snippet}

{#if dotOnly}
  <span data-slot="status-badge" class={cn('inline-flex', className)}>
    {@render dot()}<span class="sr-only">{word}</span>
  </span>
{:else}
  <span
    data-slot="status-badge"
    class={cn(badgeVariants({ variant: variants[status] }), className)}
  >
    {@render dot()}{word}
  </span>
{/if}

<style>
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
</style>
