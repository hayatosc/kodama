<script lang="ts">
  import { placeWithoutAnchor } from '#shared/lib/top-layer.js'
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getTooltipState } from './context.js'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    ontoggle: onToggleProp,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'popover'>> = $props()

  const tooltip = getTooltipState()

  /** Places the hint above its trigger where anchor positioning is missing. */
  function ontoggle(event: ToggleEvent & { currentTarget: HTMLDivElement }): void {
    if (event.newState === 'open') {
      placeWithoutAnchor(event.currentTarget, tooltip.trigger, 'above-center', 6)
    }
    onToggleProp?.(event)
  }
</script>

<!--
  A hint popover: opening it closes other hints but no menu or dialog, Esc dismisses it, and the
  pointer can move onto it without closing it (WCAG 1.4.13). It sits above the trigger, its
  implicit anchor (interestfor sets it), and flips below at the viewport's edge
  (interest-triggered-tooltips); it fades in and out. It holds a short phrase only, never anything
  the user must read or operate: that belongs in a Popover.
-->
<div
  bind:this={ref}
  id={tooltip.id}
  popover="hint"
  data-slot="tooltip-content"
  class={cn(
    'max-w-[280px] rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md',
    'forced-colors:border forced-colors:border-[CanvasText]',
    'anchored:inset-auto anchored:my-1.5 anchored:[position-area:block-start] anchored:[position-try-fallbacks:flip-block] unanchored:fixed unanchored:inset-auto unanchored:m-0',
    'opacity-0 transition-[opacity,translate,display,overlay] duration-150 ease-out transition-discrete',
    'open:opacity-100 open:duration-100 starting:open:opacity-0',
    className,
  )}
  {ontoggle}
  {...restProps}
>
  {@render children?.()}
</div>
