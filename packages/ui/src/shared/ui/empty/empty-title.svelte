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
  data-slot="empty-title"
  class={cn('text-base font-semibold text-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</p>
