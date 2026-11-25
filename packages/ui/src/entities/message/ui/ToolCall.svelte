<script lang="ts">
  import { ChevronRight } from '@lucide/svelte'
  import { Button } from '#shared/ui/button/index.js'
  import { Progress } from '#shared/ui/progress/index.js'
  import { cn, focusRing } from '#shared/lib/utils.js'
  import { formatDuration, formatElapsed, jsonTokens, type JsonToken } from '../model/format.js'
  import CopyButton from './CopyButton.svelte'

  type Props = {
    /** The tool's name, such as `web_search`. */
    name: string
    /** One line after the name: a count, the query, or the peer agent. */
    summary?: string
    /** Elapsed time; while running it keeps counting up from this value. */
    durationMs: number
    /** The arguments, a JSON value. */
    args: unknown
    /** Closed by default; a failed call may start open. */
    open?: boolean
    class?: string
  } & (
    | { state: 'running' }
    | {
        state: 'done'
        result: string
        /** Shown after 結果, such as `4 件` or `2.4 KB`. */
        resultSize?: string
      }
    | {
        state: 'error'
        /** The tool's error as it came, on one line, such as `403 Forbidden`. */
        error: string
      }
  )

  let { open = $bindable(false), ...props }: Props = $props()

  /** Results longer than this many lines are clipped until 「すべて表示」. */
  const clampLines = 5

  const id = $props.id()
  const argsId = `${id}-args`
  const resultId = `${id}-result`

  const tokenClass: Record<JsonToken['kind'], string> = {
    key: 'text-live',
    string: 'text-running',
    literal: 'text-destructive',
    punctuation: '',
  }
  /** The printed arguments, each token keyed by where it starts in the text. */
  const tokens = $derived.by(() => {
    let offset = 0
    return jsonTokens(props.args).map((token) => {
      const start = offset
      offset += token.text.length
      return { ...token, start }
    })
  })

  let now = $state(Date.now())
  /** When the call started, by this device's clock; follows a new durationMs from the caller. */
  const startedAt = $derived(Date.now() - props.durationMs)
  const elapsedMs = $derived(
    props.state === 'running' ? Math.max(props.durationMs, now - startedAt) : props.durationMs,
  )
  const time = $derived(
    props.state === 'running' ? formatElapsed(elapsedMs) : formatDuration(elapsedMs),
  )

  $effect(() => {
    if (props.state !== 'running') return
    const interval = setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => clearInterval(interval)
  })

  let showAll = $state(false)
  const long = $derived(props.state === 'done' && props.result.split('\n').length > clampLines)
</script>

<!--
  One tool execution folded into a row (design/components/ToolCall), on a native <details>: the
  summary is the toggle, which screen readers announce as an expanded or collapsed button, and
  Enter or Space opens it. Open, it shows the arguments and the result. A running call shows a
  dot instead of the chevron and counts its time up; a failed one turns its name and time red and
  says so to screen readers, since color alone does not. The state comes from
  tool_execution_start, _update, and _end.
-->
<details
  bind:open
  data-slot="tool-call"
  data-state={props.state}
  class={cn('group/tool text-muted-foreground', props.class)}
>
  <summary
    class={cn(
      '-mx-2 flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-base [contain:inline-size] transition-colors duration-[120ms] hover:bg-accent hover:text-foreground [&::-webkit-details-marker]:hidden',
      focusRing,
    )}
  >
    {#if props.state === 'running'}
      <span class="running-dot mx-1 size-2 shrink-0 rounded-full bg-running" aria-hidden="true"
      ></span>
    {:else}
      <ChevronRight
        class="size-4 shrink-0 transition-transform duration-150 group-open/tool:rotate-90 motion-reduce:transition-none"
        aria-hidden="true"
      />
    {/if}
    <span
      class={cn(
        'min-w-0 truncate font-semibold text-foreground',
        props.state === 'error' && 'text-destructive',
      )}>{props.name}</span
    >
    {#if props.state === 'running'}
      <span class="sr-only">実行中</span>
    {:else if props.state === 'error'}
      <span class="sr-only">失敗</span>
    {/if}
    {#if props.summary}
      <span class="min-w-0 flex-1 basis-0 truncate">· {props.summary}</span>
    {/if}
    <span
      class={cn(
        'ms-auto shrink-0 font-mono text-xs tabular-nums',
        props.state === 'error' && 'text-destructive',
      )}>{time}</span
    >
  </summary>
  <div class="mt-1 overflow-hidden rounded-lg border border-border bg-card">
    <div class="flex items-center justify-between px-3 pt-1.5 text-xs text-muted-foreground">
      <span>引数</span>
      <CopyButton for={argsId} what="引数" />
    </div>
    <pre
      id={argsId}
      class="m-0 px-3 pt-1.5 pb-2.5 font-mono text-sm leading-5 wrap-anywhere whitespace-pre-wrap text-foreground">{#each tokens as token (token.start)}<span
          class={tokenClass[token.kind]}>{token.text}</span
        >{/each}</pre>
    {#if props.state === 'running'}
      <div class="border-t border-border bg-muted">
        <p class="px-3 pt-1.5 text-xs">返事を待っています · {time}</p>
        <Progress
          aria-label="返事を待っています"
          class="mt-2.5 block h-0.5 rounded-none bg-border [&::-moz-progress-bar]:bg-muted-foreground [&::-webkit-progress-value]:bg-muted-foreground"
        />
      </div>
    {:else if props.state === 'error'}
      <div class="border-t border-border bg-destructive-soft text-destructive">
        <p class="px-3 pt-1.5 text-xs">エラー</p>
        <pre class="m-0 truncate px-3 pt-1.5 pb-2.5 font-mono text-sm leading-5">{props.error}</pre>
      </div>
    {:else}
      <div class="border-t border-border bg-muted">
        <div class="flex items-center justify-between px-3 pt-1.5 text-xs">
          <span>結果{props.resultSize ? ` · ${props.resultSize}` : ''}</span>
          <CopyButton for={resultId} what="結果" />
        </div>
        <div class={cn(long && !showAll && 'clamp')}>
          <pre
            id={resultId}
            class="m-0 px-3 pt-1.5 pb-2.5 font-mono text-sm leading-5 wrap-anywhere whitespace-pre-wrap">{props.result}</pre>
        </div>
        {#if long}
          <div class="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showAll}
              aria-controls={resultId}
              onclick={() => (showAll = !showAll)}
            >
              {showAll ? '折りたたむ' : 'すべて表示'}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</details>

<style>
  /* Five lines and a fade into the muted section; 「すべて表示」 lifts the clip. */
  .clamp {
    position: relative;
    max-block-size: 104px;
    overflow: hidden;
  }

  .clamp::after {
    content: '';
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    block-size: 40px;
    background: linear-gradient(transparent, var(--muted));
  }

  @media (prefers-reduced-motion: no-preference) {
    .running-dot {
      animation: pulse 1.6s ease-in-out infinite;
    }
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
