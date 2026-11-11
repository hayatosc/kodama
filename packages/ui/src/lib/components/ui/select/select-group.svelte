<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLOptgroupAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLOptgroupAttributes, HTMLOptGroupElement> = $props()
</script>

<!-- An <optgroup>; its `label` is the group's heading. -->
<optgroup bind:this={ref} data-slot="select-group" class={cn(className)} {...restProps}>
  {@render children?.()}
</optgroup>
