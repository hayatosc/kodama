<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!--
  An <article> that groups one piece of content (card guide), in header, content, footer order.
  It is a size container, so its parts can adapt to its own width with @container.
  Links and buttons inside stay separate native controls.
-->
<article
  bind:this={ref}
  data-slot="card"
  class={cn(
    '@container flex flex-col gap-4 rounded-xl border border-border bg-card p-5 text-foreground',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</article>
