<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!-- The card's own actions, as native links and buttons. -->
<footer
  bind:this={ref}
  data-slot="card-footer"
  class={cn('flex flex-wrap items-center gap-2', className)}
  {...restProps}
>
  {@render children?.()}
</footer>
