<script lang="ts">
  import { placeWithoutAnchor } from '#shared/lib/top-layer.js'
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getPopoverState } from './context.js'
  import type { Attachment } from 'svelte/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    align = 'start',
    ontoggle: onToggleProp,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'popover'>> & {
    /** Which edge of the trigger the popover lines up with, below it. */
    align?: 'start' | 'center' | 'end'
  } = $props()

  const popover = getPopoverState()

  /** Where it opens below the trigger, and the corner it scales from. */
  const placement = {
    start: 'anchored:[position-area:block-end_span-inline-end] anchored:origin-top-left',
    center: 'anchored:[position-area:block-end] anchored:origin-top',
    end: 'anchored:[position-area:block-end_span-inline-start] anchored:origin-top-right',
  }

  /**
   * Shows or hides the popover when `open` changes in code. Closing from code while focus is
   * inside, such as after a choice, returns focus to the trigger; the browser already does that
   * for Esc and the trigger itself.
   */
  const followOpen: Attachment<HTMLDivElement> = (element) => {
    const shown = element.matches(':popover-open')
    if (popover.open && !shown) {
      element.showPopover()
      return
    }
    if (popover.open || !shown) return
    const focusInside = element.contains(document.activeElement)
    element.hidePopover()
    if (focusInside) popover.trigger?.focus()
  }

  /**
   * Keeps `open` in step with the browser (the trigger, Esc, and a click outside). When the popover
   * opens, it is placed by its trigger where anchor positioning is missing, and focus moves to the
   * element marked `data-autofocus`.
   */
  function ontoggle(event: ToggleEvent & { currentTarget: HTMLDivElement }): void {
    popover.open = event.newState === 'open'
    if (!popover.open) {
      onToggleProp?.(event)
      return
    }
    placeWithoutAnchor(event.currentTarget, popover.trigger, `below-${align}`)
    event.currentTarget.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    onToggleProp?.(event)
  }
</script>

<!--
  A native auto popover (dialog guide, rule 3): the browser puts it in the top layer and closes
  it on Esc and on a click outside. It sits just below the trigger, tethered with anchor
  positioning, and flips when it would overflow the viewport (viewport-aware-dropdowns,
  natural-interactions). It fades in and out like a dialog. The menu surface of
  design/components/Select: popover, 1px border, rounded-xl, shadow-lg.
-->
<div
  bind:this={ref}
  id={popover.id}
  popover="auto"
  data-slot="popover-content"
  data-align={align}
  style={`position-anchor: --${popover.id}`}
  class={cn(
    'min-w-55 rounded-xl border border-border bg-popover p-1 text-foreground shadow-lg',
    'opacity-0 transition-[opacity,scale,display,overlay] duration-150 transition-discrete motion-reduce:duration-100',
    'open:not-data-closing:opacity-100 starting:open:not-data-closing:opacity-0',
    'motion-safe:scale-96 motion-safe:open:not-data-closing:scale-100 motion-safe:starting:open:not-data-closing:scale-96',
    'anchored:inset-auto anchored:my-1 anchored:[position-try-fallbacks:flip-block,flip-inline,flip-block_flip-inline] unanchored:fixed unanchored:inset-auto unanchored:m-0',
    placement[align],
    className,
  )}
  {ontoggle}
  {@attach followOpen}
  {...restProps}
>
  {@render children?.()}
</div>
