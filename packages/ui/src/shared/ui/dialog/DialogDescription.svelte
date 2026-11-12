<script lang="ts">
  import { onDestroy } from 'svelte'
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getDialogState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLParagraphElement>> = $props()

  const dialog = getDialogState()
  dialog.described = true
  onDestroy(() => (dialog.described = false))
</script>

<p
  bind:this={ref}
  id={`${dialog.id}-description`}
  data-slot="dialog-description"
  class={cn('text-base text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</p>
