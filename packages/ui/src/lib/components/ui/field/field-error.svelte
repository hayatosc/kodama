<script lang="ts">
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import { onDestroy } from 'svelte'
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { getFieldState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    message,
    ...restProps
  }: WithElementRef<Omit<HTMLAttributes<HTMLParagraphElement>, 'children'>> & {
    /** What is wrong and how to fix it; nothing shows while it is empty. */
    message?: string
  } = $props()

  const field = getFieldState()
  const shown = $derived(Boolean(message))

  // Linked to the control for as long as it is rendered; while empty it describes nothing.
  if (field) field.erred = true
  onDestroy(() => {
    if (field) field.erred = false
  })
</script>

<!--
  The error under the control (forms guide): always rendered as a polite live region, so a new
  message is announced, with an icon besides the color so the error is not shown by color alone.
  While empty it takes no room: the negative margin cancels the field's gap.
-->
<p
  bind:this={ref}
  id={field ? `${field.id}-error` : undefined}
  data-slot="field-error"
  aria-live="polite"
  class={cn('flex items-start gap-1 text-xs leading-4 text-destructive empty:-mt-1.5', className)}
  {...restProps}
>
  {#if shown}<CircleAlertIcon
      class="mt-px size-3.5 shrink-0"
      strokeWidth={2}
      aria-hidden="true"
    />{message}{/if}
</p>
