<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    label,
    hint,
    value,
    children,
  }: {
    label: string
    /** One sentence under the label in muted extra-small text. */
    hint?: string
    /** A read-only value at the right edge, in mono. */
    value?: string
    /** The control at the right edge instead: a Select or a Switch. */
    children?: Snippet
  } = $props()
</script>

<div class="flex min-h-10 items-center justify-between gap-3 pr-2 pl-3 text-sm">
  <span class="flex min-w-0 flex-col py-[7px]">
    <span>{label}</span>
    {#if hint}<small class="text-xs text-muted-foreground">{hint}</small>{/if}
  </span>
  {#if children}
    {@render children()}
  {:else if value !== undefined}
    <span class="pr-2 font-mono text-xs text-muted-foreground">{value}</span>
  {/if}
</div>
