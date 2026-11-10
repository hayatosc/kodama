<script lang="ts">
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import { cn, focusRing } from '#lib/utils.js'

  let {
    label,
    hint,
    onclick,
  }: {
    /** A verb phrase, such as エージェントをアーカイブ. */
    label: string
    hint?: string
    /** Opens the confirmation dialog; the row itself never acts directly. */
    onclick: () => void
  } = $props()
</script>

<!-- A destructive action, placed last in its card. -->
<button
  type="button"
  class={cn(
    'flex min-h-10 w-full cursor-pointer items-center justify-between gap-3 pr-3 pl-3 text-left text-sm text-destructive hover:bg-destructive-soft',
    focusRing,
  )}
  {onclick}
>
  <span class="flex min-w-0 flex-col py-[7px]">
    <span>{label}</span>
    {#if hint}<small class="text-xs text-muted-foreground">{hint}</small>{/if}
  </span>
  <ChevronRightIcon class="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
</button>
