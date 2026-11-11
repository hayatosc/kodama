/**
 * Keyboard and focus behavior of a dropdown menu that native focusgroup and invoker commands
 * leave to script (menu guide — Keyboard and focus).
 *
 * @module
 */

import { cn, focusRing } from '#shared/lib/utils.js'
import type { Attachment } from 'svelte/attachments'
import type { ClassValue } from 'svelte/elements'
import type { DropdownMenuState } from './context.js'

/** How long a checked item stays visible before the menu closes, so the change is seen. */
export const CHECKED_CLOSE_DELAY = 300

/** Whether the browser has native focusgroup, which moves focus with the arrow keys. */
export function supportsFocusgroup(): boolean {
  return typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype
}

/**
 * The items of a menu's focusgroup, in order. Items marked aria-disabled stay in, as they do in
 * native focusgroup; only natively disabled buttons, which cannot take focus, are left out.
 */
export function menuItems(group: Element): HTMLButtonElement[] {
  return [...group.querySelectorAll('button')].filter(
    (item) => item.closest('[focusgroup]') === group && !item.disabled,
  )
}

/** Focuses the first enabled item of an open menu. */
export function focusFirstItem(menu: DropdownMenuState): void {
  const group = menu.content?.querySelector('[focusgroup]')
  if (group) menuItems(group)[0]?.focus()
}

/**
 * Closes the menu and returns focus to its trigger, without a focus ring after a pointer
 * activation (a click with `detail` 0 came from the keyboard). Focus moves before the popover
 * hides, so it never stays in hidden content.
 */
export function closeMenu(menu: DropdownMenuState, fromPointer: boolean): void {
  menu.trigger?.focus({ focusVisible: !fromPointer })
  if (menu.content?.matches(':popover-open')) menu.content.hidePopover()
}

/**
 * The keys focusgroup leaves to script: Home and End, and where focusgroup is missing also the
 * arrow keys, wrapping at either end. Where it is missing, the group also takes role="menu".
 */
export const menuKeys: Attachment<HTMLElement> = (group) => {
  const native = supportsFocusgroup()
  if (!native) group.setAttribute('role', 'menu')
  const keys = native ? ['Home', 'End'] : ['ArrowDown', 'ArrowUp', 'Home', 'End']
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!keys.includes(event.key)) return
    const items = menuItems(group)
    const current = items.findIndex((item) => item === document.activeElement)
    if (current < 0) return
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    event.preventDefault()
    items[next]?.focus({ preventScroll: true })
  }
  group.addEventListener('keydown', onKeyDown)
  return () => group.removeEventListener('keydown', onKeyDown)
}

/**
 * Gives an item the `menuitem` role where focusgroup is missing; native focusgroup infers it,
 * and an explicit role would block that. Checkable items set their own role and are left alone.
 */
export const fallbackItemRole: Attachment<HTMLElement> = (item) => {
  if (!supportsFocusgroup() && !item.hasAttribute('role')) item.setAttribute('role', 'menuitem')
}

/** Moving the pointer over an item focuses it without a ring, so hover and focus are one item. */
export function focusOnPointer(event: PointerEvent & { currentTarget: HTMLElement }): void {
  if (event.pointerType === 'touch') return
  if (document.activeElement !== event.currentTarget) {
    event.currentTarget.focus({ focusVisible: false })
  }
}

/**
 * A menu row: a fixed 16px leading slot that holds the item's icon or, on a checked item, the
 * check mark (drawn in src/shared/styles/native.css), so labels line up either way.
 */
export function menuItemClass(
  variant: 'default' | 'destructive',
  className: ClassValue | null | undefined,
): string {
  return cn(
    'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm',
    'text-foreground select-none pointer-coarse:min-h-11',
    'hover:bg-accent focus-visible:bg-accent',
    focusRing,
    'focus-visible:-outline-offset-2',
    'disabled:pointer-events-none disabled:opacity-40',
    'aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent',
    "before:size-4 before:shrink-0 before:content-[''] has-[>svg]:before:hidden",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variant === 'destructive' && 'text-destructive [&_svg]:text-destructive',
    className,
  )
}
