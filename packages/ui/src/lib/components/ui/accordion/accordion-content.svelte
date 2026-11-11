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

<!-- The disclosed content, indented to the label past the chevron. Closed, it stays findable with find-in-page. -->
<div
  bind:this={ref}
  data-slot="accordion-content"
  class={cn('ps-6 pb-4 text-sm text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</div>
