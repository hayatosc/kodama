<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLTdAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTdAttributes, HTMLTableCellElement> = $props()
</script>

<td
  bind:this={ref}
  data-slot="table-cell"
  class={cn('border-b border-border px-3 py-2.5 align-middle', className)}
  {...restProps}
>
  {@render children?.()}
</td>
