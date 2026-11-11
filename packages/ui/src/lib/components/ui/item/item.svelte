<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { isInItemGroup } from './context.js'
  import { itemVariants, type ItemSize, type ItemVariant } from './variants.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    variant = 'plain',
    size = 'default',
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> & {
    variant?: ItemVariant
    size?: ItemSize
  } = $props()

  const inGroup = isInItemGroup()
</script>

<!--
  A row: media, a title and description, and actions at the end. Inside an Item.Group it is an
  <li>. To make the whole row a link or a button, put the link in the title and stretch it over
  the row with `after:absolute after:inset-0` (the card guide's stretched link); actions stay
  above it.
-->
<svelte:element
  this={inGroup ? 'li' : 'div'}
  bind:this={ref}
  data-slot="item"
  class={cn(
    itemVariants({ variant, size }),
    'relative transition-colors duration-[120ms] has-[[data-slot=item-title]>:is(a,button):hover]:bg-accent',
    '[&_[data-slot=item-actions]]:relative [&_[data-slot=item-actions]]:z-[1]',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</svelte:element>
