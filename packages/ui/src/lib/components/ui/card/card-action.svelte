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

<!-- One control at the end of the header, such as a menu button. -->
<div bind:this={ref} data-slot="card-action" class={cn(className)} {...restProps}>
  {@render children?.()}
</div>
