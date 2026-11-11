<script lang="ts">
  import { onDestroy } from 'svelte'
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { getDialogState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLHeadingElement>> = $props()

  const dialog = getDialogState()
  dialog.labelled = true
  onDestroy(() => (dialog.labelled = false))
</script>

<!-- Every dialog title is an h2, so dialogs share one heading level (dialog guide). -->
<h2
  bind:this={ref}
  id={`${dialog.id}-title`}
  data-slot="dialog-title"
  class={cn('type-lg', className)}
  {...restProps}
>
  {@render children?.()}
</h2>
