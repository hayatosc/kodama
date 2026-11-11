<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLDetailsAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    open = $bindable(false),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLDetailsAttributes, HTMLDetailsElement> = $props()
</script>

<!-- A native <details>: one section that opens and closes. -->
<details bind:this={ref} bind:open data-slot="collapsible" class={cn(className)} {...restProps}>
  {@render children?.()}
</details>
