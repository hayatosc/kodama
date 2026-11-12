<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { setInItemGroup } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>, HTMLUListElement> = $props()

  setInItemGroup()
</script>

<!-- A list of items: a native <ul>, so screen readers announce how many there are. -->
<ul
  bind:this={ref}
  data-slot="item-group"
  role="list"
  class={cn('flex flex-col', className)}
  {...restProps}
>
  {@render children?.()}
</ul>
