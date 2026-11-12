<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    align = 'inline-start',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /** Before or after the input, in the reading direction. */
    align?: 'inline-start' | 'inline-end'
  } = $props()
</script>

<!-- An icon, text, or InputGroup.Button before or after the input. -->
<div
  bind:this={ref}
  data-slot="input-group-addon"
  data-align={align}
  class={cn(
    'flex h-full shrink-0 items-center gap-1.5 text-sm text-muted-foreground [&_svg]:pointer-events-none',
    "[&_svg:not([class*='size-'])]:size-4",
    align === 'inline-start' ? 'order-first ps-3' : 'order-last pe-1.5',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
