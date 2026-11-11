<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props()
</script>

<div
  bind:this={ref}
  data-slot="item-media"
  class={cn(
    "flex shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-5",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
