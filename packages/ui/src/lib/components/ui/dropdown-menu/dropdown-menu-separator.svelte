<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLHRElement>, HTMLHRElement> = $props()
</script>

<!-- A native <hr>: a separator role, never focusable, skipped by focusgroup. -->
<hr
  bind:this={ref}
  data-slot="dropdown-menu-separator"
  class={cn('-mx-1 my-1 h-0 border-0 border-t border-border', className)}
  {...restProps}
/>
