<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cn } from '#lib/utils.js'

  let {
    title,
    class: className,
    children,
  }: {
    /** The section heading above the card, such as 設定 or ルーティン. */
    title?: string
    class?: string
    /** SettingsRow and SettingsAction rows; a 1px line separates them. */
    children: Snippet
  } = $props()
</script>

<section class={cn('flex flex-col gap-2', className)} aria-label={title}>
  {#if title}
    <h3 class="px-1 text-xs text-muted-foreground">{title}</h3>
  {/if}
  <div
    class="flex flex-col rounded-xl border border-border py-1 [&>*+*]:border-t [&>*+*]:border-border"
  >
    {@render children()}
  </div>
</section>
