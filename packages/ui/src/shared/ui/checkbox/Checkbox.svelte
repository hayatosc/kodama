<script lang="ts">
  import CheckIcon from '@lucide/svelte/icons/check'
  import MinusIcon from '@lucide/svelte/icons/minus'
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import { choiceControl } from './control.js'
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

  /** A mark over the box, scaled in with its state. */
  const mark =
    'pointer-events-none col-start-1 row-start-1 size-2.5 scale-0 text-primary-foreground motion-safe:transition-[scale] motion-safe:duration-[120ms]'
</script>

<!--
  A native checkbox with a custom look (checkbox guide): a 16px box with lucide's check, or its
  minus while indeterminate, over the fill. The marks take the text color, which turns
  CanvasText in forced colors mode. The input cannot hold them, so they sit beside it in a
  wrapper, as Switch's knob does. The wrapper dims as one when disabled and is the peer a
  following Label dims with. Put it before its label, and give the label a 44px-high row so the whole row is the target.
-->
<span
  data-slot="checkbox"
  class={cn(
    'peer relative inline-grid size-4 shrink-0 place-items-center has-[:disabled]:opacity-40',
    className,
  )}
>
  <input
    bind:this={ref}
    bind:checked
    bind:indeterminate
    type="checkbox"
    {...attributes}
    class={cn(
      'peer col-start-1 row-start-1 rounded-sm',
      choiceControl,
      'indeterminate:border-primary indeterminate:bg-primary',
      focusRing,
    )}
    {...restProps}
  />
  <CheckIcon
    aria-hidden="true"
    strokeWidth={3.5}
    class={cn(mark, 'peer-[:checked:not(:indeterminate)]:scale-100')}
  />
  <MinusIcon aria-hidden="true" strokeWidth={4} class={cn(mark, 'peer-indeterminate:scale-100')} />
</span>
