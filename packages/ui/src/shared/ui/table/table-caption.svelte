<script lang="ts">
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLTableCaptionElement> = $props()
</script>

<!-- Names the table; screen readers read it when they enter the table. -->
<caption
  bind:this={ref}
  data-slot="table-caption"
  class={cn('mt-3 caption-bottom text-start text-xs text-muted-foreground', className)}
  {...restProps}
>
  {@render children?.()}
</caption>
