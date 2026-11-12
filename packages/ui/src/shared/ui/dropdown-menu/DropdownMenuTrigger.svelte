<script lang="ts">
  import { Button, type ButtonProps } from '#shared/ui/button/index.js'
  import { cn } from '#shared/lib/utils.js'
  import { getDropdownMenuState } from './context.js'
  import { focusFirstItem } from './menu.js'
  import type { Attachment } from 'svelte/attachments'

  let {
    ref = $bindable(null),
    variant = 'secondary',
    class: className,
    onpointerdown,
    onclick,
    onkeydown,
    ...restProps
  }: ButtonProps = $props()

  const menu = getDropdownMenuState()
  let pressed = false

  const register: Attachment<HTMLButtonElement> = (element) => {
    menu.trigger = element
    return () => {
      menu.trigger = null
    }
  }

  /** A pointer press does not move focus; the open menu then focuses the trigger, ringless. */
  function pointerdown(event: PointerEvent & { currentTarget: HTMLButtonElement }): void {
    onpointerdown?.(event)
    if (event.pointerType === 'touch') return
    event.preventDefault()
    pressed = true
  }

  /** Enter and Space click the trigger too; only those keyboard opens enter the menu. */
  function click(event: MouseEvent & { currentTarget: HTMLButtonElement }): void {
    onclick?.(event)
    menu.enterOnOpen = !pressed && event.detail === 0
    pressed = false
  }

  /** ArrowDown opens the menu if it is closed and focuses its first item either way. */
  function keydown(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void {
    onkeydown?.(event)
    if (event.key !== 'ArrowDown' || event.defaultPrevented) return
    event.preventDefault()
    if (menu.open) {
      focusFirstItem(menu)
      return
    }
    pressed = false
    event.currentTarget.click()
  }
</script>

<!--
  An ordinary button that toggles the menu with an invoker command; the browser opens and closes
  it on click, Enter, and Space, and the trigger becomes the menu's implicit anchor. The open
  state shows on the button as well as in aria-expanded.
-->
<Button
  bind:ref
  id={`${menu.id}-trigger`}
  data-slot="dropdown-menu-trigger"
  {variant}
  aria-haspopup="menu"
  aria-expanded={menu.open}
  commandfor={menu.id}
  command="toggle-popover"
  class={cn('aria-expanded:bg-accent', className)}
  onpointerdown={pointerdown}
  onclick={click}
  onkeydown={keydown}
  {@attach register}
  {...restProps}
/>
