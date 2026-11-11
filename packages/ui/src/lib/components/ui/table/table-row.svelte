<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
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
    'transition-colors duration-[120ms] hover:bg-accent/60 has-[[aria-selected=true]]:bg-accent',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</tr>
