<script lang="ts" module>
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
</script>

<script lang="ts">
  import { Badge, type BadgeVariant } from '#lib/components/ui/badge/index.js'
  import { cn } from '#lib/utils.js'

  let {
    status,
    label,
    dotOnly = false,
    class: className,
  }: {
    status: RunState
    /** Overrides the default word (稼働中, 実行中, …). */
    label?: string
    /** Only the dot, for sidebar rows; the word becomes its accessible name. */
    dotOnly?: boolean
    class?: string
  } = $props()

  const word = $derived(label ?? RUN_STATE_LABELS[status])

  /** Only three states have a color; the rest stay neutral (success is quiet on purpose). */
  const variant = $derived.by((): BadgeVariant => {
    if (status === 'live') return 'live'
    if (status === 'running') return 'running'
    if (status === 'error') return 'destructive'
    return 'neutral'
  })

  /** The dot's shape carries the state too, so color is never the only signal. */
  const dot = $derived(
    {
      live: 'bg-live',
      running: 'bg-running animate-blink motion-reduce:animate-none',
      error: 'bg-destructive',
      queued: 'bg-transparent shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]',
      paused: 'rounded-[2px] bg-transparent shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]',
      done: 'bg-muted-foreground',
      archived: 'bg-muted-foreground',
    }[status],
  )
</script>

{#if dotOnly}
  <span
    role="img"
    aria-label={word}
    data-status={status}
    class={cn('inline-block size-2 shrink-0 rounded-full', dot, className)}
  ></span>
{:else}
  <Badge {variant} data-status={status} class={className}>
    <span aria-hidden="true" class={cn('inline-block size-2 shrink-0 rounded-full', dot)}></span>
    {word}
  </Badge>
{/if}
