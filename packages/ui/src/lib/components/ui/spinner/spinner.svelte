<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
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
  progress bar with its label. It takes the text color; set its size with --spinner-size.
  The styles are in src/lib/styles/native.css.
-->
<progress
  bind:this={ref}
  data-slot="spinner"
  aria-label={label}
  class={cn(className)}
  {...restProps}
></progress>
