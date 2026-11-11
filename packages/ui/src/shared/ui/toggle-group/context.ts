/**
 * The state a toggle group shares with its items: which values are pressed.
 *
 * @module
 */

import { createContext } from 'svelte'
import type { ToggleSize, ToggleVariant } from '../toggle/variants.js'

/** Shared by ToggleGroup.Root with its items. */
export type ToggleGroupState = {
  isPressed(value: string): boolean
  press(value: string): void
  readonly variant: ToggleVariant
  readonly size: ToggleSize
  readonly disabled: boolean
}

/** Reads and provides the state of the nearest ToggleGroup.Root. */
export const [getToggleGroupState, setToggleGroupState] = createContext<ToggleGroupState>()
