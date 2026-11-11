/**
 * The state a dropdown menu's parts share, and the radio group's value.
 *
 * @module
 */

import { createContext } from 'svelte'

/** Shared by Root, which owns it, and the parts inside it. */
export type DropdownMenuState = {
  /** The menu popover's id, which Trigger names in `commandfor`. */
  readonly id: string
  open: boolean
  trigger: HTMLButtonElement | null
  content: HTMLDivElement | null
  /** Set when the keyboard opens the menu, so it focuses its first item once open. */
  enterOnOpen: boolean
}

/** Reads and provides the state of the nearest DropdownMenu.Root. */
export const [getDropdownMenuState, setDropdownMenuState] = createContext<DropdownMenuState>()

/** Shared by RadioGroup with its RadioItems. */
export type DropdownMenuRadioState = {
  value: string
}

/** Reads and provides the value of the nearest DropdownMenu.RadioGroup. */
export const [getDropdownMenuRadioState, setDropdownMenuRadioState] =
  createContext<DropdownMenuRadioState>()
