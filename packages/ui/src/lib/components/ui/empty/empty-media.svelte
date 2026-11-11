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
  data-slot="empty-media"
  class={cn(
    "flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg:not([class*='size-'])]:size-5",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
