<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import { Collapsible } from 'bits-ui'
  import { cn, focusRing } from '#lib/utils.js'
  import CopyButton from './CopyButton.svelte'
  import { formatDuration, jsonTokens } from './format.js'

  let {
    name,
    summary,
    state: callState,
    durationMs,
    startedAt,
    args,
    result,
    resultSize,
    resultLabel = '結果',
    pendingLabel = '返事を待っています',
    error,
    open = $bindable(false),
  }: {
    /** The tool's name, such as web_search. */
    name: string
    /** One line: a count, the query, or the peer agent's name. */
    summary?: string
    state: 'running' | 'done' | 'error'
    /** How long the call took, once it is over. */
    durationMs?: number
    /** While running, the start time (epoch ms) the duration counts up from. */
    startedAt?: number
    /** The arguments, shown as highlighted JSON. */
    args?: unknown
    result?: string
    /** Such as 5 件 or 2.4 KB, after the result heading. */
    resultSize?: string
    /** The result heading; contact_agent calls it 返事 (the reply). */
    resultLabel?: string
    /** What the lower section says while the call runs. */
    pendingLabel?: string
    /** The tool's own error, shown as is on one line. */
    error?: string
    /** Closed by default; a failed call may start open. */
    open?: boolean
  } = $props()

  let now = $state(Date.now())
  let showAll = $state(false)

  /** The running duration counts up once a second. */
  $effect(() => {
    if (callState !== 'running' || startedAt === undefined) return
    const timer = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(timer)
  })

  const elapsed = $derived(
    callState === 'running' && startedAt !== undefined ? now - startedAt : durationMs,
  )
  const time = $derived(elapsed === undefined ? undefined : formatDuration(elapsed))
  const argsText = $derived(args === undefined ? '' : JSON.stringify(args, null, 2))
  /** More than five lines is clipped at 104px with a fade, behind すべて表示 (show all). */
  const long = $derived((result ?? '').split('\n').length > 5)
</script>

<Collapsible.Root bind:open class="text-muted-foreground">
  <Collapsible.Trigger
    class={cn(
      '-mx-2 flex h-9 w-[calc(100%+16px)] cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-base',
      'group hover:bg-accent hover:text-foreground',
      focusRing,
    )}
  >
    {#if callState === 'running'}
      <span class="flex size-4 items-center justify-center" role="img" aria-label="実行中">
        <span class="size-2 animate-blink rounded-full bg-running motion-reduce:animate-none"
        ></span>
      </span>
    {:else}
      <ChevronRightIcon
        class="size-4 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    {/if}
    <span
      class={cn('font-semibold', callState === 'error' ? 'text-destructive' : 'text-foreground')}
      >{name}</span
    >
    {#if summary}<span class="min-w-0 truncate">· {summary}</span>{/if}
    {#if time}
      <span class={cn('ml-auto font-mono text-xs', callState === 'error' && 'text-destructive')}
        >{time}</span
      >
    {/if}
  </Collapsible.Trigger>
  <Collapsible.Content class="mt-1 overflow-hidden rounded-lg border border-border bg-card">
    {#if args !== undefined}
      <div class="flex items-center justify-between px-3 pt-1.5 text-xs">
        <span>引数</span>
        <CopyButton text={argsText} />
      </div>
      <pre class="code px-3 pt-1.5 pb-2.5 text-foreground"><code
          >{#each jsonTokens(args) as token, index (index)}<span class={token.kind}>{token.text}</span>{/each}</code
        ></pre>
    {/if}
    {#if callState === 'running'}
      <div class="border-t border-border bg-muted">
        <p class="px-3 pt-2 pb-0 text-xs">{pendingLabel}{time ? ` · ${time}` : ''}</p>
        <div
          class="progress mt-2.5 h-0.5 overflow-hidden bg-border"
          role="progressbar"
          aria-label={pendingLabel}
        ></div>
      </div>
    {:else if callState === 'error'}
      <div class="border-t border-border bg-destructive-soft text-destructive">
        <div class="px-3 pt-1.5 text-xs">エラー</div>
        <pre class="code truncate px-3 pt-1.5 pb-2.5">{error}</pre>
      </div>
    {:else if result !== undefined}
      <div class="border-t border-border bg-muted">
        <div class="flex items-center justify-between px-3 pt-1.5 text-xs">
          <span>{resultLabel}{resultSize ? ` · ${resultSize}` : ''}</span>
          <CopyButton text={result} />
        </div>
        <pre class={['code px-3 pt-1.5 pb-2.5', long && !showAll && 'clipped']}>{result}</pre>
        {#if long}
          <div class="flex justify-center pt-1 pb-2">
            <button
              type="button"
              class={cn(
                'h-7 cursor-pointer rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
                focusRing,
              )}
              aria-expanded={showAll}
              onclick={() => (showAll = !showAll)}>{showAll ? '折りたたむ' : 'すべて表示'}</button
            >
          </div>
        {/if}
      </div>
    {/if}
  </Collapsible.Content>
</Collapsible.Root>

<style>
  .code {
    margin: 0;
    font: 14px/20px var(--font-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .code .key {
    color: var(--live);
  }
  .code .string {
    color: var(--running);
  }
  .code .number {
    color: var(--destructive);
  }
  .clipped {
    max-height: 104px;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 60%, transparent);
  }
  .progress::before {
    content: '';
    display: block;
    width: 30%;
    height: 100%;
    background: var(--muted-foreground);
    animation: indeterminate 1.4s ease-in-out infinite;
  }
  @keyframes indeterminate {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .progress::before {
      animation: none;
    }
  }
</style>
