/**
 * The state an accordion shares with its items: the name that makes it exclusive.
 *
 * @module
 */

import { getContext, setContext } from 'svelte'

const key = Symbol('accordion')

/** Shared by Accordion.Root with its items. */
export type AccordionState = {
  /** The `name` every item's <details> shares, so one opens at a time; unset for multiple. */
  readonly name: string | undefined
}

/** Provides the accordion's state to its items. */
export function setAccordionState(state: AccordionState): void {
  setContext(key, state)
}

/** The nearest Accordion.Root's state. */
export function getAccordionState(): AccordionState | undefined {
  return getContext<AccordionState | undefined>(key)
}
