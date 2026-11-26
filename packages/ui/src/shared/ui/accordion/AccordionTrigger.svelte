<script lang="ts">
  import { cn, focusRing, type WithElementRef } from '#shared/lib/utils.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>> = $props()
</script>

<!--
  The native <summary>, which screen readers expose as a button. Do not put a heading inside it:
  some screen readers drop headings in a summary. The default triangle gives way to a chevron
  drawn as a mask right before the label, pointing to the inline end while closed and down while
  open.
-->
<summary
  bind:this={ref}
  data-slot="accordion-trigger"
  class={cn(
    'flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden',
    'before:size-4 before:shrink-0 before:-rotate-90 before:bg-muted-foreground before:mask-chevron-down rtl:before:rotate-90 [[open]>&]:before:rotate-0 forced-colors:before:bg-[CanvasText] motion-safe:before:transition-[rotate] motion-safe:before:duration-200',
    'min-h-11 rounded-md py-2 text-sm font-semibold text-foreground transition-colors duration-[120ms] hover:text-foreground/80',
    focusRing,
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</summary>
