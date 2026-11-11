<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#lib/utils.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLInputAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value = $bindable(50),
    min = 0,
    max = 100,
    step = 1,
    class: className,
    id,
    'aria-describedby': describedBy,
    ...restProps
  }: WithElementRef<
    Omit<HTMLInputAttributes, 'type' | 'value' | 'min' | 'max' | 'step'>,
    HTMLInputElement
  > & {
    value?: number
    min?: number
    max?: number
    step?: number
  } = $props()

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, { id, 'aria-describedby': describedBy }),
  )

  /** The filled share of the track, which WebKit cannot read from the input itself. */
  const progress = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0)
</script>

<!--
  A native range input with the design's track and thumb (slider guide): the browser keeps the
  keyboard, pointer, and touch handling. The fill is passed as --slider-progress, since typed
  attr() is not in every browser. Show the value in text beside it, and set aria-valuetext when
  the number needs a unit.
-->
<input
  bind:this={ref}
  bind:value
  type="range"
  data-slot="slider"
  {min}
  {max}
  {step}
  {...attributes}
  style={`--slider-progress: ${progress}%`}
  class={cn(focusRing, className)}
  {...restProps}
/>
