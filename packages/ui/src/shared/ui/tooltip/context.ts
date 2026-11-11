/**
 * The state a tooltip's parts share: the hint's id and its trigger.
 *
 * @module
 */

import { createContext } from 'svelte'

/** Shared by Root, which owns it, and Trigger and Content. */
export type TooltipState = {
  /** The hint's id, which Trigger names in `interestfor`. */
  readonly id: string
  /** The trigger, which Content is placed by where anchor positioning is missing. */
  trigger: HTMLElement | null
}

/** Reads and provides the state of the nearest Tooltip.Root. */
export const [getTooltipState, setTooltipState] = createContext<TooltipState>()
