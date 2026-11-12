<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableRowElement>, HTMLTableRowElement> = $props()
</script>

<tr
  bind:this={ref}
  data-slot="table-row"
  class={cn(
    'transition-colors duration-[120ms] hover:bg-accent/60',
    // A selected row is more than a darker hover: a bar in the text color marks its start edge.
    'has-[[aria-selected=true]]:bg-accent has-[[aria-selected=true]]:shadow-[inset_2px_0_0_var(--foreground)]',
    'forced-colors:has-[[aria-selected=true]]:bg-[Highlight] forced-colors:has-[[aria-selected=true]]:text-[HighlightText]',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</tr>
