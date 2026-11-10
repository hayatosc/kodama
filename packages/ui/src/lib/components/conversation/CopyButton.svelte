<script lang="ts">
  import CopyIcon from '@lucide/svelte/icons/copy'
  import { cn, focusRing } from '#lib/utils.js'

  let { text, class: className }: { text: string; class?: string } = $props()

  let copied = $state(false)

  /** Copies, then says so for 1.4 seconds. A refused clipboard leaves the label unchanged. */
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    copied = true
    setTimeout(() => (copied = false), 1400)
  }
</script>

<button
  type="button"
  class={cn(
    'inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground',
    'hover:bg-accent hover:text-foreground',
    focusRing,
    className,
  )}
  onclick={() => void copy()}
>
  <CopyIcon class="size-3" strokeWidth={1.75} aria-hidden="true" />
  <span aria-live="polite">{copied ? 'コピーしました' : 'コピー'}</span>
</button>
