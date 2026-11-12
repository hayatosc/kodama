<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLParagraphElement>> = $props()
</script>

<p
  bind:this={ref}
  data-slot="item-description"
  class={cn('truncate text-xs leading-4 text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</p>
