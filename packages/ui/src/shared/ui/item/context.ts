/**
 * Whether items render inside an Item.Group, which makes them list items.
 *
 * @module
 */

import { getContext, setContext } from 'svelte'

const key = Symbol('item-group')

/** Marks the parts below as inside an Item.Group. */
export function setInItemGroup(): void {
  setContext(key, true)
}

/** Whether the item is inside an Item.Group. */
export function isInItemGroup(): boolean {
  return getContext<boolean | undefined>(key) === true
}
