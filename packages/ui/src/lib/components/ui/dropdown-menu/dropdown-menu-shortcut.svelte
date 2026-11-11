<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> = $props()
</script>

<!--
  The shortcut at the row's end, hidden from assistive technology; give the item
  aria-keyshortcuts to announce it.
-->
<span
  bind:this={ref}
  aria-hidden="true"
  data-slot="dropdown-menu-shortcut"
  class={cn('ms-auto ps-4 text-xs text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</span>
