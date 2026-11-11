<script lang="ts">
  import { cn, type WithElementRef } from '#lib/utils.js'
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
   * Keeps `open` in step with the browser (the trigger, Esc, and a click outside), and moves focus
   * to the element marked `data-autofocus` when the popover opens.
   */
  function ontoggle(event: ToggleEvent & { currentTarget: HTMLDivElement }): void {
    popover.open = event.newState === 'open'
    if (popover.open) event.currentTarget.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    onToggleProp?.(event)
  }
</script>

<!--
  A native auto popover (dialog guide, rule 3): the browser puts it in the top layer and closes
  it on Esc and on a click outside. It sits below the trigger and flips at the viewport's edges;
  the placement and the transitions are in src/lib/styles/native.css. The menu surface of
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
    'min-w-[220px] rounded-xl border border-border bg-popover p-1 text-foreground shadow-lg',
    className,
  )}
  {ontoggle}
  {@attach followOpen}
  {...restProps}
>
  {@render children?.()}
</div>
