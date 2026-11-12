<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLTableSectionElement>, HTMLTableSectionElement> = $props()
</script>

<tfoot
  bind:this={ref}
  data-slot="table-footer"
  class={cn('bg-muted font-semibold', className)}
  {...restProps}
>
  {@render children?.()}
</tfoot>
