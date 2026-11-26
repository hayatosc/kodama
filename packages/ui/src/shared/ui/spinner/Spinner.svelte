<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLProgressAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    label = '読み込み中',
    ...restProps
  }: WithElementRef<Omit<HTMLProgressAttributes, 'value' | 'max'>, HTMLProgressElement> & {
    /** What is loading, read by screen readers; the default is 読み込み中 (Loading). */
    label?: string
  } = $props()
</script>

<!--
  An indeterminate <progress> drawn as a ring (spinner guide), so screen readers announce a busy
  progress bar with its label. It takes the text color; set its size with --spinner-size. The
  primary arc is a conic gradient hollowed out by background-clip: border-area, or by a mask where
  that is missing. Under a reduced-motion request it turns slowly instead of stopping, so the work
  still reads as ongoing; forced colors mode keeps it, in system colors.
-->
<progress
  bind:this={ref}
  data-slot="spinner"
  aria-label={label}
  class={cn(
    '[--spinner-color:currentColor] [--spinner-duration:800ms] [--spinner-size:16px] [--spinner-thickness:2px] [--spinner-track:color-mix(in_oklab,currentColor_20%,transparent)] motion-reduce:[--spinner-duration:6s]',
    'size-(--spinner-size) shrink-0 animate-spinner appearance-none rounded-[50%] [background:conic-gradient(var(--spinner-color)_100deg,transparent_0)_var(--spinner-track)]',
    'supports-[background-clip:border-area]:[border:var(--spinner-thickness)_solid_transparent] supports-[background-clip:border-area]:bg-origin-border supports-[background-clip:border-area]:[background-clip:border-area]',
    'not-supports-[background-clip:border-area]:border-0 not-supports-[background-clip:border-area]:[mask-image:radial-gradient(farthest-side,transparent_calc(100%-var(--spinner-thickness)),black_calc(100%-var(--spinner-thickness)))]',
    '[&::-moz-progress-bar]:hidden [&::-webkit-progress-bar]:hidden [&::-webkit-progress-value]:hidden',
    'forced-colors:[--spinner-color:CanvasText] forced-colors:[--spinner-track:Canvas] forced-colors:[forced-color-adjust:none]',
    className,
  )}
  {...restProps}
></progress>
