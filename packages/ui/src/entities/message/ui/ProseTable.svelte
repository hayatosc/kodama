<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLTableAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLTableAttributes, HTMLTableElement> = $props()
</script>

<!--
  A table in a reply, inside a box that scrolls sideways when the table is wider than the bubble,
  so the table keeps its native semantics (a table set to display: block loses them in some
  screen readers). Its look comes from Prose.
-->
<div data-slot="prose-table" class="overflow-x-auto">
  <table bind:this={ref} class={cn(className)} {...restProps}>
    {@render children?.()}
  </table>
</div>
