<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    orientation = 'horizontal',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    orientation?: 'horizontal' | 'vertical'
  } = $props()
</script>

<!--
  Related buttons joined into one shape, named as a group (role="group" with an aria-label).
  Each button stays its own Tab stop: a group of actions is not a toolbar, which would need one
  Tab stop and arrow keys (toolbar guide).
-->
<div
  bind:this={ref}
  role="group"
  data-slot="button-group"
  data-orientation={orientation}
  class={cn(
    'flex w-fit items-stretch [&>*]:focus-visible:relative [&>*]:focus-visible:z-[1]',
    orientation === 'horizontal'
      ? '[&>*:not(:first-child)]:-ms-px [&>*:not(:first-child)]:rounded-s-none [&>*:not(:last-child)]:rounded-e-none'
      : 'flex-col [&>*:not(:first-child)]:-mt-px [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</div>
