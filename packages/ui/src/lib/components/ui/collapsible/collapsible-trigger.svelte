<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!-- The native <summary>, with the chevron right before its label. -->
<summary
  bind:this={ref}
  data-slot="collapsible-trigger"
  class={cn('min-h-8 w-fit rounded-md text-sm text-foreground', focusRing, className)}
  {...restProps}
>
  {@render children?.()}
</summary>
