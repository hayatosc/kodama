<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!-- One key combination: an outer <kbd> around a <kbd> per key, as the HTML spec nests them. -->
<kbd
  bind:this={ref}
  data-slot="keyboard-key-group"
  class={cn('inline-flex items-center gap-1 font-normal', className)}
  {...restProps}
>
  {@render children?.()}
</kbd>
