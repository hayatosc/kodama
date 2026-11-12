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
  move focus to it. The styles are in src/shared/styles/native.css.
-->
<progress bind:this={ref} data-slot="progress" {...attributes} class={cn(className)} {...restProps}
></progress>
