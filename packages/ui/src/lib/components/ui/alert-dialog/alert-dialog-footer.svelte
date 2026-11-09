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

<!-- Buttons are right-aligned: cancel first, then confirm. -->
<div
  bind:this={ref}
  data-slot="alert-dialog-footer"
  class={cn('mt-6 flex justify-end gap-2', className)}
  {...restProps}
>
  {@render children?.()}
</div>
