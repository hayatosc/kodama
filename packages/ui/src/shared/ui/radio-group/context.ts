/**
 * The state a radio group shares with its items: the group's name and the chosen value.
 *
 * @module
 */

import { createContext } from 'svelte'

/** Shared by RadioGroup.Root, which owns it, and its items. */
export type RadioGroupState = {
  /** The name every radio in the group submits under. */
  readonly name: string
  value: string | undefined
  readonly disabled: boolean
}

/** Reads and provides the state of the nearest RadioGroup.Root. */
export const [getRadioGroupState, setRadioGroupState] = createContext<RadioGroupState>()
