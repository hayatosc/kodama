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

<!-- Buttons are right-aligned, the safe one first (design/components/Dialog). -->
<div
  bind:this={ref}
  data-slot="dialog-footer"
  class={cn('flex flex-wrap justify-end gap-2', className)}
  {...restProps}
>
  {@render children?.()}
</div>
