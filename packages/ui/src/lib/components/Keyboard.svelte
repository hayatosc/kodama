<script lang="ts">
  import { cn } from '#lib/utils.js'

  let {
    keys,
    label,
    class: className,
  }: {
    /** The key text as shown: Tab, ⏎, ⇧ ⏎, Esc, ⌘ K (Ctrl K off the Mac). */
    keys: string
    /** What the key does, shown to its right in muted extra-small text. */
    label?: string
    class?: string
  } = $props()
</script>

<span class={cn('inline-flex items-center gap-1.5', className)}>
  <kbd
    class="inline-flex h-5 min-w-[22px] items-center justify-center rounded-sm border border-b-2 border-border bg-background px-[5px] font-mono text-[11px] leading-none text-foreground"
    >{keys}</kbd
  >
  {#if label}
    <span class="text-xs text-muted-foreground">{label}</span>
  {/if}
</span>
