<script lang="ts">
  import { type WithElementRef } from '#shared/lib/utils.js'
  import { getDropdownMenuRadioState, getDropdownMenuState } from './context.js'
  import { CHECKED_CLOSE_DELAY, closeMenu, focusOnPointer, menuItemClass } from './menu.js'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    value,
    class: className,
    onclick,
    children,
    ...restProps
  }: WithElementRef<
    Omit<HTMLButtonAttributes, 'type' | 'role' | 'aria-checked' | 'value'>,
    HTMLButtonElement
  > & {
    value: string
  } = $props()

  const menu = getDropdownMenuState()
  const group = getDropdownMenuRadioState()

  /** Checks this item; any key or a click closes the menu once the check mark has moved. */
  function check(event: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    group.value = value
    onclick?.(event)
    if (event.defaultPrevented) return
    const fromPointer = event.detail !== 0
    setTimeout(() => closeMenu(menu, fromPointer), CHECKED_CLOSE_DELAY)
  }
</script>

<button
  bind:this={ref}
  type="button"
  role="menuitemradio"
  aria-checked={group.value === value}
  data-slot="dropdown-menu-radio-item"
  class={menuItemClass('default', className)}
  onclick={check}
  onpointermove={focusOnPointer}
  {...restProps}
>
  {@render children?.()}
</button>
