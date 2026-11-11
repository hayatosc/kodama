<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { setAccordionState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    type = 'multiple',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    /**
     * `multiple` lets any number of items stay open (the default, and the better one: readers can
     * compare items). `single` closes the open item when another opens.
     */
    type?: 'single' | 'multiple'
  } = $props()

  const id = $props.id()

  setAccordionState({
    get name() {
      return type === 'single' ? `accordion-${id}` : undefined
    },
  })
</script>

<!--
  Adjacent <details> items (accordion guide). No roving focus or arrow keys: Tab moves between
  triggers, and arrow keys keep scrolling the page. Name the group with aria-label or a heading
  when it is a section of its own.
-->
<div bind:this={ref} data-slot="accordion" class={cn('flex flex-col', className)} {...restProps}>
  {@render children?.()}
</div>
