<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#lib/utils.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    ...restProps
  }: WithElementRef<Omit<HTMLInputAttributes, 'type'>, HTMLInputElement> = $props()

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': invalid,
    }),
  )
</script>

<!--
  A native checkbox with a custom look (checkbox guide): 16px, a check or a dash drawn through a
  mask, which turns CanvasText in forced colors mode; see src/lib/styles/native.css. Put it
  before its label, and give the label a 44px-high row so the whole row is the target.
-->
<input
  bind:this={ref}
  bind:checked
  bind:indeterminate
  type="checkbox"
  data-slot="checkbox"
  {...attributes}
  class={cn('peer', focusRing, className)}
  {...restProps}
/>
