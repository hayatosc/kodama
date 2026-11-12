<script lang="ts">
  import { type WithElementRef } from '#shared/lib/utils.js'
  import { getDropdownMenuState } from './context.js'
  import { CHECKED_CLOSE_DELAY, closeMenu, focusOnPointer, menuItemClass } from './menu.js'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    class: className,
    onclick,
    onkeydown,
    children,
    ...restProps
  }: WithElementRef<
    Omit<HTMLButtonAttributes, 'type' | 'role' | 'aria-checked'>,
    HTMLButtonElement
  > & {
    checked?: boolean
  } = $props()

  const menu = getDropdownMenuState()
  let bySpace = false

  /** Space clicks on key up, so remember it here: Space keeps the menu open (APG). */
  function keydown(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void {
    onkeydown?.(event)
    bySpace = event.key === ' '
  }

  /** Toggles; Enter and a click then close the menu once the new check mark has shown. */
  function toggle(event: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    checked = !checked
    onclick?.(event)
    const stayOpen = bySpace || event.defaultPrevented
    bySpace = false
    if (stayOpen) return
    const fromPointer = event.detail !== 0
    setTimeout(() => closeMenu(menu, fromPointer), CHECKED_CLOSE_DELAY)
  }
</script>

<!-- focusgroup does not infer menuitemcheckbox, so this item sets its role itself. -->
<button
  bind:this={ref}
  type="button"
  role="menuitemcheckbox"
  aria-checked={checked}
  data-slot="dropdown-menu-checkbox-item"
  class={menuItemClass('default', className)}
  onclick={toggle}
  onkeydown={keydown}
  onpointermove={focusOnPointer}
  {...restProps}
>
  {@render children?.()}
</button>
