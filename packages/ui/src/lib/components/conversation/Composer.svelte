<script lang="ts">
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SquareIcon from '@lucide/svelte/icons/square'
  import XIcon from '@lucide/svelte/icons/x'
  import { Button } from '../ui/button/index.js'
  import Keyboard from '../Keyboard.svelte'
  import { cn, focusRing } from '#lib/utils.js'

  let {
    agentName,
    running,
    queue,
    onsend,
    onqueue,
    onremove,
    oncancel,
    mobile = false,
    value = $bindable(''),
    class: className,
  }: {
    /** The placeholder is only 「〈name〉にメッセージ」, with no key hints. */
    agentName: string
    /** A run is active: Enter steers it, Tab queues, and an empty input offers stop. */
    running: boolean
    /** Messages this screen holds until the run ends; none has reached the agent yet. */
    queue: string[]
    /** Enter: send now. While running this interrupts the run (`whenBusy: 'steer'`). */
    onsend: (text: string) => void
    /** Tab while running, or the button on phones: add to this screen's queue. */
    onqueue: (text: string) => void
    onremove: (index: number) => void
    oncancel: () => void
    /** Phones have no Tab key, so the sheet shows a キューに追加 (add to queue) button. */
    mobile?: boolean
    /** The draft in the input. */
    value?: string
    class?: string
  } = $props()

  const typing = $derived(value.trim() !== '')
  const multiline = $derived(value.includes('\n'))
  /** The sheet opens only while typing during a run, or when something is queued. */
  const sheet = $derived((running && typing) || queue.length > 0)

  function send(): void {
    if (!typing) return
    onsend(value)
    value = ''
  }

  function enqueue(): void {
    if (!typing) return
    onqueue(value)
    value = ''
  }

  function onkeydown(event: KeyboardEvent): void {
    // Enter that confirms an IME conversion must not send.
    if (event.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    } else if (event.key === 'Tab' && !event.shiftKey && running && typing) {
      event.preventDefault()
      enqueue()
    }
  }
</script>

{#snippet tabHint()}
  {#if mobile}
    <button
      type="button"
      class={cn(
        'ml-auto h-7 cursor-pointer rounded-full border border-input bg-background px-3 text-sm font-semibold text-foreground hover:bg-accent',
        focusRing,
      )}
      onclick={enqueue}>キューに追加</button
    >
  {:else}
    <span class="ml-auto inline-flex items-center gap-1.5">
      <Keyboard keys="Tab" />でキューに追加
    </span>
  {/if}
{/snippet}

<div class={cn('mx-auto w-full max-w-[720px]', className)}>
  {#if sheet}
    <div
      class="relative z-0 mx-5 -mb-px flex flex-col gap-0.5 rounded-t-xl border border-b-0 border-border bg-card px-1.5 pt-1.5 pb-2"
    >
      <div
        class="flex min-h-[22px] items-center gap-3 px-2 pt-0.5 pb-1 text-xs text-muted-foreground"
      >
        {#if queue.length > 0}
          <span>キュー {queue.length}</span>
          {#if running && typing}
            {@render tabHint()}
          {:else}
            <span class="ml-auto">実行が終わったら順に送ります</span>
          {/if}
        {:else}
          {@render tabHint()}
        {/if}
      </div>
      {#if queue.length > 0}
        <ol class="flex flex-col gap-0.5">
          {#each queue as item, index (index)}
            <li class="flex h-8 items-center gap-2 rounded-md pr-0.5 pl-2 text-sm hover:bg-accent">
              <span class="w-3.5 font-mono text-[11px] leading-none text-muted-foreground"
                >{index + 1}</span
              >
              <span class="min-w-0 flex-1 truncate">{item}</span>
              <Button
                variant="ghost"
                size="icon"
                class="size-[26px] rounded-md text-muted-foreground"
                aria-label={`キューから外す: ${item}`}
                onclick={() => onremove(index)}
              >
                <XIcon class="size-3.5" strokeWidth={1.75} />
              </Button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
  <div
    class={cn(
      'relative z-10 flex min-h-12 items-end gap-1 border border-border bg-background p-1.5 shadow-lg focus-within:border-input',
      multiline ? 'rounded-3xl' : 'rounded-full',
    )}
  >
    <Button variant="ghost" size="round" class="text-muted-foreground" aria-label="添付">
      <PlusIcon strokeWidth={1.75} />
    </Button>
    <textarea
      bind:value
      {onkeydown}
      rows="1"
      placeholder={`${agentName}にメッセージ`}
      aria-label={`${agentName}にメッセージ`}
      class="field min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground"
    ></textarea>
    {#if running && !typing}
      <Button size="round" aria-label="停止" onclick={oncancel}>
        <SquareIcon class="size-3 fill-current" strokeWidth={1.75} />
      </Button>
    {:else}
      <Button size="round" aria-label="送信" disabled={!typing} onclick={send}>
        <ArrowUpIcon strokeWidth={1.75} />
      </Button>
    {/if}
  </div>
</div>

<style>
  /* The input grows with Shift+Enter lines, up to about eight. */
  .field {
    field-sizing: content;
    max-height: 12rem;
  }
</style>
