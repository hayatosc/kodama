<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { alertVariants, type AlertVariant } from './variants.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    variant = 'neutral',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & { variant?: AlertVariant } = $props()
</script>

<!--
  A message in the page, with an optional icon first. It has no role of its own: a message on
  the page from the start is read in order. For one that appears later, render it inside a live
  region (role="status", or role="alert" when it cannot wait).
-->
<div
  bind:this={ref}
  data-slot="alert"
  class={cn(alertVariants({ variant }), className)}
  {...restProps}
>
  {@render children?.()}
</div>
