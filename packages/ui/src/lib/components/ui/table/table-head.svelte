<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLThAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    scope = 'col',
    children,
    ...restProps
  }: WithElementRef<HTMLThAttributes, HTMLTableCellElement> = $props()
</script>

<!-- A header cell: `col` heads a column (the default), `row` heads a row. -->
<th
  bind:this={ref}
  data-slot="table-head"
  {scope}
  class={cn(
    'h-10 border-b border-border px-3 text-start align-middle text-xs font-normal whitespace-nowrap text-muted-foreground',
    scope === 'row' && 'h-auto py-2.5 text-sm font-semibold text-foreground',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</th>
