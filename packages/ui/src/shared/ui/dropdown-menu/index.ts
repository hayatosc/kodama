/**
 * DropdownMenu in the shape of shadcn-svelte's, built on an invoker-command popover and native
 * focusgroup (menu guide), with a script fallback where focusgroup is missing.
 *
 * @module
 */

import CheckboxItem from './dropdown-menu-checkbox-item.svelte'
import Content from './dropdown-menu-content.svelte'
import Group from './dropdown-menu-group.svelte'
import Item from './dropdown-menu-item.svelte'
import RadioGroup from './dropdown-menu-radio-group.svelte'
import RadioItem from './dropdown-menu-radio-item.svelte'
import Separator from './dropdown-menu-separator.svelte'
import Shortcut from './dropdown-menu-shortcut.svelte'
import Trigger from './dropdown-menu-trigger.svelte'
import Root from './dropdown-menu.svelte'

/**
 * The parts of a popup menu, used as `DropdownMenu.Root`, `DropdownMenu.Item`, …. Content must
 * come right after Trigger.
 */
export {
  Root,
  Trigger,
  Content,
  Item,
  CheckboxItem,
  RadioGroup,
  RadioItem,
  Group,
  Separator,
  Shortcut,
}
