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

<!-- design/components/Kbd: 20px high, a 2px bottom edge, mono at 11px. -->
<kbd
  bind:this={ref}
  data-slot="keyboard-key"
  class={cn(
    'inline-flex h-5 min-w-[22px] items-center justify-center gap-1 rounded-sm border border-b-2 border-border bg-background px-[5px] font-mono text-[11px] leading-none font-normal text-foreground',
    "[&_svg:not([class*='size-'])]:size-3",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</kbd>
