<script lang="ts">
  import { ArrowUp, Plus, Square, X } from '@lucide/svelte'
  import { Button } from '#shared/ui/button/index.js'
  import * as KeyboardKey from '#shared/ui/keyboard-key/index.js'
  import { cn, focusRing } from '#shared/lib/utils.js'
  import { tick } from 'svelte'

  let {
    value = $bindable(''),
    agentName,
    running = false,
    queue = [],
    onsend,
    onqueue,
    onremove,
    oncancel,
    mobile = false,
    class: className,
  }: {
    /** The text being typed; bind it to keep a draft. */
    value?: string
    /** The agent this conversation is with, named in the placeholder (assistantにメッセージ). */
    agentName: string
    /** Whether the agent is running now. */
    running?: boolean
    /**
     * Messages this screen holds until the run ends, oldest first. They are not sent to the agent
     * yet: when the run ends, the caller sends them one at a time from the top and removes each.
     */
    queue?: readonly string[]
    /** Enter: send now. While running, this interrupts the run (`whenBusy: 'steer'`). */
    onsend: (text: string) => void
    /** Tab while running (a button on phones): add to the queue. */
    onqueue: (text: string) => void
    /** The queue's × removes an item; it was never sent, so it just goes. */
    onremove: (index: number) => void
    /** Stop: cancel the run. Once it stops, send from the front of the queue. */
    oncancel: () => void
    /** Phones have no Tab key, so the sheet offers a 「キューに追加」 button instead. */
    mobile?: boolean
    class?: string
  } = $props()

  const id = $props.id()
  const hintId = `${id}-hint`

  let field: HTMLTextAreaElement | null = $state(null)

  const typed = $derived(value.trim())
  const canQueue = $derived(running && typed !== '')
  const sheetOpen = $derived(queue.length > 0 || canQueue)
  const placeholder = $derived(`${agentName}にメッセージ`)

  function send(): void {
    if (!typed) return
    onsend(typed)
    value = ''
  }

  function addToQueue(): void {
    if (!canQueue) return
    onqueue(typed)
    value = ''
    document.ariaNotify('キューに追加しました')
  }

  async function remove(index: number): Promise<void> {
    onremove(index)
    document.ariaNotify('キューから外しました')
    // The button is gone with its row, so focus goes back to the input rather than the page.
    await tick()
    field?.focus()
  }

  /**
   * Enter sends and Shift+Enter breaks the line. Tab queues only while running with something
   * typed; otherwise it moves focus as usual, so the input never traps the keyboard. Nothing
   * happens while an input method is composing, so Enter can confirm Japanese text. Safari sends
   * that confirming Enter after the composition ends, with isComposing false and keyCode 229.
   */
  function onkeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    } else if (event.key === 'Tab' && !event.shiftKey && canQueue && !mobile) {
      event.preventDefault()
      addToQueue()
    }
  }
</script>

<!--
  The input floating at the bottom of a conversation (design/components/Composer), centered in
  the 720px column. While the agent runs, typing opens a sheet above the input that offers Tab to
  queue; the sheet also lists the queue. The input grows with its lines (field-sizing; where that
  is missing it keeps one line and scrolls), and its 24px corners make a pill at one line. While
  it is empty it stays one line, so a placeholder too long for a narrow screen is cut off with an
  ellipsis rather than wrapping.
-->
<div data-slot="composer" class={cn('mx-auto w-full max-w-[720px]', className)}>
  {#if sheetOpen}
    <div
      role="group"
      aria-label="キュー"
      class="relative z-0 mx-5 -mb-px flex flex-col gap-0.5 rounded-t-xl border border-b-0 border-border bg-card px-1.5 pt-1.5 pb-2"
    >
      <div
        class="flex min-h-[22px] items-center gap-3 px-2 pt-0.5 pb-1 text-xs text-muted-foreground"
      >
        {#if queue.length > 0}
          <span class="shrink-0 whitespace-nowrap">キュー {queue.length}</span>
        {/if}
        {#if canQueue && mobile}
          <button
            type="button"
            class={cn(
              'h-7 cursor-pointer rounded-full border border-input px-3 text-sm font-semibold text-foreground transition-colors duration-[120ms] hover:bg-accent',
              queue.length > 0 && 'ms-auto',
              focusRing,
            )}
            onclick={addToQueue}>キューに追加</button
          >
        {:else if canQueue}
          <span id={hintId} class={cn(queue.length > 0 && 'ms-auto')}
            ><KeyboardKey.Root>Tab</KeyboardKey.Root> でキューに追加</span
          >
        {:else}
          <span class="ms-auto min-w-0 text-end [word-break:keep-all]"
            >実行が終わったら<wbr />順に送ります</span
          >
        {/if}
      </div>
      {#if queue.length > 0}
        <ol class="flex flex-col gap-0.5">
          <!-- A queued message is only its text and place; the place is its identity. -->
          {#each queue as item, index (index)}
            <li
              class="flex h-8 items-center gap-2 rounded-md ps-2 pe-0.5 text-sm text-foreground hover:bg-accent"
            >
              <span class="w-3.5 font-mono text-[11px] text-muted-foreground" aria-hidden="true"
                >{index + 1}</span
              >
              <span class="min-w-0 flex-1 truncate">{item}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                class="size-[26px] rounded-full text-muted-foreground hover:text-foreground"
                aria-label={`${index + 1} 件目をキューから外す`}
                onclick={() => remove(index)}
              >
                <X class="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
  <form
    class="relative z-10 flex items-end gap-1 rounded-[24px] border border-border bg-background p-[7px] shadow-lg transition-colors duration-[120ms] focus-within:border-input"
    onsubmit={(event) => {
      event.preventDefault()
      send()
    }}
  >
    <Button variant="ghost" size="icon-sm" class="rounded-full" aria-label="添付">
      <Plus aria-hidden="true" />
    </Button>
    <textarea
      bind:this={field}
      bind:value
      rows="1"
      {placeholder}
      aria-label={placeholder}
      aria-describedby={canQueue && !mobile ? hintId : undefined}
      class="max-h-[8lh] min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-1 text-base leading-6 text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground placeholder-shown:h-8 placeholder-shown:overflow-hidden placeholder-shown:text-ellipsis placeholder-shown:whitespace-nowrap placeholder-shown:[field-sizing:fixed]"
      {onkeydown}></textarea>
    {#if running && !typed}
      <Button size="icon-sm" class="rounded-full" aria-label="停止" onclick={oncancel}>
        <Square class="fill-current" aria-hidden="true" />
      </Button>
    {:else}
      <Button type="submit" size="icon-sm" class="rounded-full" aria-label="送信" disabled={!typed}>
        <ArrowUp aria-hidden="true" />
      </Button>
    {/if}
  </form>
</div>
