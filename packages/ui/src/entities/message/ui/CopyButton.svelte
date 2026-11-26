<script module lang="ts">
  /** The last message any copy button announced, page-wide (see report). */
  let lastAnnounced = ''
</script>

<script lang="ts">
  import { Check, Copy } from '@lucide/svelte'
  import { cn, focusRing } from '#shared/lib/utils.js'

  let {
    for: target,
    what,
    class: className,
  }: {
    /** The id of the element whose text is copied. */
    for: string
    /**
     * What is copied, named before the label (`引数` → 引数をコピー) so the buttons differ. The
     * name always contains the visible label, so speech input can say what it shows.
     */
    what: string
    class?: string
  } = $props()

  /** How long the label says it copied (design/components/ToolCall). */
  const feedbackMs = 1400

  let status = $state<'idle' | 'copied' | 'failed'>('idle')
  let announcement = $state('')
  let timer: ReturnType<typeof setTimeout> | undefined

  const label = $derived(
    status === 'copied'
      ? 'コピーしました'
      : status === 'failed'
        ? 'コピーできませんでした'
        : 'コピー',
  )

  /**
   * Copies on the `--copy` command this button sends to its target (copy-button guide). Command
   * events do not bubble and fire on the target, so the listener sits on the document in the
   * capture phase and answers only this button.
   */
  function listen(button: HTMLButtonElement): () => void {
    function oncommand(event: Event): void {
      if (!(event instanceof CommandEvent) || event.source !== button) return
      if (!(event.target instanceof HTMLElement)) return
      // Untrimmed, so a code block keeps its first line's indentation.
      void copy(event.target.innerText)
    }
    document.addEventListener('command', oncommand, true)
    return () => {
      document.removeEventListener('command', oncommand, true)
      clearTimeout(timer)
    }
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      report('copied')
    } catch {
      report('failed')
    }
  }

  /**
   * Shows the result on the label and announces it in the status region next to the button: a
   * live region inside a button is not reliably announced. VoiceOver skips a message identical to
   * the last one, so a repeat gets a no-break space.
   */
  function report(result: 'copied' | 'failed'): void {
    clearTimeout(timer)
    status = result
    let message =
      result === 'copied' ? `${what}をコピーしました` : `${what}をコピーできませんでした`
    if (message === lastAnnounced) message += ' '
    lastAnnounced = message
    announcement = ''
    requestAnimationFrame(() => {
      announcement = message
    })
    timer = setTimeout(() => {
      status = 'idle'
      announcement = ''
    }, feedbackMs)
  }
</script>

<span class={cn('inline-flex', className)}>
  <button
    type="button"
    command="--copy"
    commandfor={target}
    aria-label={`${what}を${label}`}
    data-state={status}
    class={cn(
      'inline-flex h-5.5 min-w-6 cursor-pointer items-center gap-1 rounded-sm px-1.5 font-sans text-xs text-muted-foreground transition-colors duration-120 hover:bg-accent hover:text-foreground data-[state=failed]:text-destructive',
      focusRing,
    )}
    {@attach listen}
  >
    {#if status === 'copied'}
      <Check class="size-3" aria-hidden="true" />
    {:else}
      <Copy class="size-3" aria-hidden="true" />
    {/if}
    {label}
  </button>
  <span role="status" class="sr-only">{announcement}</span>
</span>
