<script lang="ts">
  import { onDestroy } from 'svelte'
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { getFieldState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLParagraphElement>> = $props()

  const field = getFieldState()
  if (field) field.described = true
  onDestroy(() => {
    if (field) field.described = false
  })
</script>

<!-- Help text, linked to the control with aria-describedby. Put format rules here, not in a placeholder. -->
<p
  bind:this={ref}
  id={field ? `${field.id}-description` : undefined}
  data-slot="field-description"
  class={cn('text-xs leading-4 text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</p>
