<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { fieldControlAttributes, getFieldState } from '../field/context.js'
  import type { HTMLProgressAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    id,
    'aria-describedby': describedBy,
    ...restProps
  }: WithElementRef<HTMLProgressAttributes, HTMLProgressElement> = $props()

  const field = getFieldState()
  const attributes = $derived(
    fieldControlAttributes(field, { id, 'aria-describedby': describedBy }),
  )
</script>

<!--
  A native <progress> (progress guide): screen readers announce it as a progress bar with its
  value. Without `value` it is indeterminate. Name it with a label (a Field links one) and never
  move focus to it. A 6px track in muted with a primary fill; the indeterminate fill exists only
  through its animation, which slows down rather than stops under a reduced-motion request.
-->
<progress
  bind:this={ref}
  data-slot="progress"
  {...attributes}
  class={cn(
    '@container h-1.5 w-full appearance-none overflow-clip rounded-full border-0 border-solid bg-muted forced-colors:border forced-colors:border-[CanvasText]',
    '[--progress-duration:1.5s] motion-reduce:[--progress-duration:10s] rtl:[--progress-direction:reverse]',
    '[&::-webkit-progress-bar]:bg-transparent',
    '[&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:[transition:inline-size_300ms] indeterminate:[&::-webkit-progress-value]:animate-progress forced-colors:[&::-webkit-progress-value]:bg-[CanvasText]',
    '[&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-primary indeterminate:[&::-moz-progress-bar]:animate-progress forced-colors:[&::-moz-progress-bar]:bg-[CanvasText]',
    className,
  )}
  {...restProps}
></progress>
