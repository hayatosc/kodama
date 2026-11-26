<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
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
  the number needs a unit. The track is 4px and fills with primary up to the thumb, a 16px thumb
  with a primary ring; the 24px box (40px on touch screens) is the interaction area. Forced colors
  mode removes the gradient fill, so the track is drawn in the text color there.
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
  class={cn(
    'm-0 h-6 w-full cursor-pointer appearance-none border-0 bg-transparent p-0 pointer-coarse:h-10 disabled:cursor-not-allowed disabled:opacity-40',
    '[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:linear-gradient(to_right,var(--primary)_var(--slider-progress,50%),var(--input)_var(--slider-progress,50%))] rtl:[&::-webkit-slider-runnable-track]:[background:linear-gradient(to_left,var(--primary)_var(--slider-progress,50%),var(--input)_var(--slider-progress,50%))] forced-colors:[&::-webkit-slider-runnable-track]:[background:CanvasText]',
    '[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm',
    '[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-input forced-colors:[&::-moz-range-track]:bg-[CanvasText]',
    '[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary',
    '[&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-sm',
    focusRing,
    className,
  )}
  {...restProps}
/>
