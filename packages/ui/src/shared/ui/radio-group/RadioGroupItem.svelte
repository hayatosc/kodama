<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import { getRadioGroupState } from './context.js'
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value,
    disabled,
    class: className,
    id,
    'aria-describedby': describedBy,
    ...restProps
  }: WithElementRef<
    Omit<HTMLInputAttributes, 'type' | 'name' | 'checked' | 'value'>,
    HTMLInputElement
  > & {
    value: string
  } = $props()

  const group = getRadioGroupState()
  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, { id, 'aria-describedby': describedBy }),
  )
</script>

<!--
  A native radio; the dot is drawn in src/shared/styles/native.css. Put it before its label, or in a
  horizontal Field, which links the label and description to it.
-->
<input
  bind:this={ref}
  type="radio"
  data-slot="radio-group-item"
  {...attributes}
  name={group.name}
  {value}
  checked={group.value === value}
  disabled={disabled ?? group.disabled}
  onchange={() => (group.value = value)}
  class={cn('peer', focusRing, className)}
  {...restProps}
/>
