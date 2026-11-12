<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props()
</script>

<!-- Fixed text beside the input, such as a unit or a URL prefix. -->
<span
  bind:this={ref}
  data-slot="input-group-text"
  class={cn('text-sm whitespace-nowrap text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</span>
