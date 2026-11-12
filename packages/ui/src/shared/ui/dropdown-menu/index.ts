/**
 * DropdownMenu in the shape of shadcn-svelte's, built on an invoker-command popover and native
 * focusgroup (menu guide), with a script fallback where focusgroup is missing.
 *
 * @module
 */

import CheckboxItem from './DropdownMenuCheckboxItem.svelte'
import Content from './DropdownMenuContent.svelte'
import Group from './DropdownMenuGroup.svelte'
import Item from './DropdownMenuItem.svelte'
import RadioGroup from './DropdownMenuRadioGroup.svelte'
import RadioItem from './DropdownMenuRadioItem.svelte'
import Separator from './DropdownMenuSeparator.svelte'
import Shortcut from './DropdownMenuShortcut.svelte'
import Trigger from './DropdownMenuTrigger.svelte'
import Root from './DropdownMenu.svelte'

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
