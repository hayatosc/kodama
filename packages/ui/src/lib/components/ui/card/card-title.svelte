<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    level = 3,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLHeadingElement>> & {
    /** The heading level, so cards fit the page's outline; h3 by default. */
    level?: 2 | 3 | 4 | 5 | 6
  } = $props()
</script>

<svelte:element
  this={`h${level}`}
  bind:this={ref}
  data-slot="card-title"
  class={cn('text-base leading-6 font-semibold', className)}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
