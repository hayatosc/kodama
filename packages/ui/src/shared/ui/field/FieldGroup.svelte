<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props()
</script>

<!-- Fields in one column, farther apart than a label from its control. -->
<div
  bind:this={ref}
  data-slot="field-group"
  class={cn('flex flex-col gap-6', className)}
  {...restProps}
>
  {@render children?.()}
</div>
