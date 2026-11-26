<script lang="ts">
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
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
  some screen readers drop headings in a summary. The default triangle gives way to lucide's
  chevron right before the label, pointing to the inline end while closed and down while open.
-->
<summary
  bind:this={ref}
  data-slot="accordion-trigger"
  class={cn(
    'flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden',
    'min-h-11 rounded-md py-2 text-sm font-semibold text-foreground transition-colors duration-120 hover:text-foreground/80',
    focusRing,
    className,
  )}
  {...restProps}
>
  <ChevronDownIcon
    aria-hidden="true"
    strokeWidth={1.75}
    class="size-4 shrink-0 -rotate-90 text-muted-foreground rtl:rotate-90 [[open]>*>&]:rotate-0 motion-safe:transition-[rotate] motion-safe:duration-200"
  />
  {@render children?.()}
</summary>
