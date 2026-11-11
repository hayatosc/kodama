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

<!-- The label and description beside a control in a horizontal field. -->
<div
  bind:this={ref}
  data-slot="field-content"
  class={cn('flex min-w-0 flex-col gap-0.5', className)}
  {...restProps}
>
  {@render children?.()}
</div>
