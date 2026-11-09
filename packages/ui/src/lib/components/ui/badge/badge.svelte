<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { badgeVariants, type BadgeVariant } from './variants.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    variant = 'neutral',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> & {
    variant?: BadgeVariant
  } = $props()
</script>

<span
  bind:this={ref}
  data-slot="badge"
  class={cn(badgeVariants({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</span>
