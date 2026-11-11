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

<!-- The row's name; a link or button inside it can stretch over the whole row. -->
<div
  bind:this={ref}
  data-slot="item-title"
  class={cn(
    'flex min-w-0 items-center gap-2 truncate leading-5 font-semibold',
    '[&>a,&>button]:outline-none [&>a,&>button]:after:absolute [&>a,&>button]:after:inset-0 [&>a,&>button]:after:rounded-xl [&>a,&>button]:after:content-[""]',
    '[&>a:focus-visible,&>button:focus-visible]:after:outline-2 [&>a:focus-visible,&>button:focus-visible]:after:outline-offset-2 [&>a:focus-visible,&>button:focus-visible]:after:outline-ring',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
