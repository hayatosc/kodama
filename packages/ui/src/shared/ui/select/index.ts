/**
 * Select in the shape of shadcn-svelte's, built on the native customizable <select>, styled as
 * design/components/Select. For a searchable list, compose Popover and Command instead (see the
 * Combobox stories).
 *
 * @module
 */

import Group from './SelectGroup.svelte'
import Item from './SelectItem.svelte'
import Separator from './SelectSeparator.svelte'
import Root from './Select.svelte'

/**
 * The parts of a native select: Root is the `<select>`, Item an `<option>`, Group an
 * `<optgroup>`, Separator an `<hr>`.
 */
export { Root, Item, Group, Separator }
