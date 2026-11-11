<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { getFieldState } from '../field/context.js'
  import type { HTMLLabelAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    for: htmlFor,
    children,
    ...restProps
  }: WithElementRef<HTMLLabelAttributes, HTMLLabelElement> = $props()

  const field = getFieldState()
</script>

<!-- A native label; inside a Field it names the field's control without a `for` of its own. -->
<label
  bind:this={ref}
  data-slot="label"
  for={htmlFor ?? (field ? `${field.id}-control` : undefined)}
  class={cn(
    'inline-flex items-center gap-2 text-sm leading-5 font-semibold text-foreground select-none',
    'peer-disabled:cursor-not-allowed peer-disabled:opacity-40',
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</label>
