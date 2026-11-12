<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLLegendElement>, HTMLLegendElement> = $props()
</script>

<legend
  bind:this={ref}
  data-slot="field-legend"
  class={cn('mb-1 text-base font-semibold text-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</legend>
