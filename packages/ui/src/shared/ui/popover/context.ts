/**
 * The state a popover's parts share: the popover's id, whether it is open, and its trigger.
 *
 * @module
 */

import { createContext } from 'svelte'

/** Shared by Root, which owns it, and Trigger and Content. */
export type PopoverState = {
  /** The popover's id, which Trigger names in `popovertarget`. */
  readonly id: string
  open: boolean
  /** The trigger, which Content anchors to and returns focus to. */
  trigger: HTMLButtonElement | null
}

/** Reads and provides the state of the nearest Popover.Root. */
export const [getPopoverState, setPopoverState] = createContext<PopoverState>()
