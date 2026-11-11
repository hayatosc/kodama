<script lang="ts">
  import { type WithElementRef } from '#lib/utils.js'
  import { getDropdownMenuState } from './context.js'
  import { closeMenu, fallbackItemRole, focusOnPointer, menuItemClass } from './menu.js'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    variant = 'default',
    disabled = false,
    class: className,
    onclick,
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLButtonAttributes, 'type' | 'disabled'>, HTMLButtonElement> & {
    /**
     * Shows the item as unavailable. It stays focusable, so keyboard users still find it (APG),
     * but does nothing.
     */
    disabled?: boolean
    /** `destructive` for an item that deletes or cannot be undone. */
    variant?: 'default' | 'destructive'
  } = $props()

  const menu = getDropdownMenuState()

  /** Runs the caller's handler, then closes the menu unless the handler prevented it. */
  function activate(event: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    if (disabled) return
    onclick?.(event)
    if (!event.defaultPrevented) closeMenu(menu, event.detail !== 0)
  }
</script>

<!--
  A command, as a <button>; focusgroup infers role="menuitem". A disabled item uses aria-disabled
  rather than `disabled`, which would take it out of the menu. Call preventDefault in onclick to
  keep the menu open.
-->
<button
  bind:this={ref}
  type="button"
  data-slot="dropdown-menu-item"
  aria-disabled={disabled || undefined}
  class={menuItemClass(variant, className)}
  onclick={activate}
  onpointermove={focusOnPointer}
  {@attach fallbackItemRole}
  {...restProps}
>
  {@render children?.()}
</button>
