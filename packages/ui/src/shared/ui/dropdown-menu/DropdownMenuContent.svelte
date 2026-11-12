<script lang="ts">
  import { placeWithoutAnchor } from '#shared/lib/top-layer.js'
  import { cn, type WithElementRef } from '#shared/lib/utils.js'
  import { getDropdownMenuState } from './context.js'
  import { focusFirstItem, menuKeys } from './menu.js'
  import type { Attachment } from 'svelte/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    ontoggle: onToggleProp,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'popover'>> = $props()

  const menu = getDropdownMenuState()

  const register: Attachment<HTMLDivElement> = (element) => {
    menu.content = element
    return () => {
      menu.content = null
    }
  }

  /** Shows or hides the menu when `open` changes in code. */
  const followOpen: Attachment<HTMLDivElement> = (element) => {
    const shown = element.matches(':popover-open')
    if (menu.open && !shown) element.showPopover({ source: menu.trigger ?? undefined })
    if (!menu.open && shown) element.hidePopover()
  }

  /**
   * Closes the menu when focus leaves it and its trigger, such as on Tab, so focus never stays in
   * hidden content. Switching windows keeps the focused element, so it keeps the menu open.
   */
  const closeOnFocusOut: Attachment<HTMLDivElement> = (element) => {
    const onFocusOut = (): void => {
      requestAnimationFrame(() => {
        const focused = document.activeElement
        if (!element.matches(':popover-open')) return
        if (element.contains(focused) || menu.trigger?.contains(focused ?? null)) return
        element.hidePopover()
      })
    }
    element.addEventListener('focusout', onFocusOut)
    return () => element.removeEventListener('focusout', onFocusOut)
  }

  /**
   * Keeps `open` in step with the browser. Focus moves here rather than on the command, which
   * fires before the menu opens: a keyboard open enters the menu, and a pointer open focuses
   * the trigger without a ring, so the arrow keys still work.
   */
  function ontoggle(event: ToggleEvent & { currentTarget: HTMLDivElement }): void {
    menu.open = event.newState === 'open'
    if (menu.open) {
      placeWithoutAnchor(event.currentTarget, menu.trigger, 'below-start')
      if (menu.enterOnOpen) focusFirstItem(menu)
      else menu.trigger?.focus({ focusVisible: false })
      menu.enterOnOpen = false
    }
    onToggleProp?.(event)
  }
</script>

<!--
  An auto popover right after its trigger (so browsers add no aria-details), holding the menu's
  focusgroup: one Tab stop, arrow keys between items, and roles inferred by the browser. The
  focusgroup sits on an inner element, since Chromium drops its keys on the popover itself.
  Where focusgroup is missing, the group takes role="menu" and its items role="menuitem".
-->
<div
  bind:this={ref}
  id={menu.id}
  popover="auto"
  data-slot="dropdown-menu-content"
  class={cn(
    'min-w-[200px] rounded-xl border border-border bg-popover p-1 text-foreground shadow-lg',
    className,
  )}
  {ontoggle}
  {@attach register}
  {@attach followOpen}
  {@attach closeOnFocusOut}
  {...restProps}
>
  <div
    focusgroup="menu nomemory"
    aria-labelledby={`${menu.id}-trigger`}
    class="flex flex-col"
    {@attach menuKeys}
  >
    {@render children?.()}
  </div>
</div>
