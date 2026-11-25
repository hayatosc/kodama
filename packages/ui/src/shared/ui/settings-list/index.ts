/**
 * SettingsList: a card of label and value rows, styled as design/components/SettingsList.
 *
 * @module
 */

import Action from './SettingsListAction.svelte'
import Row from './SettingsListRow.svelte'
import Value from './SettingsListValue.svelte'
import Root from './SettingsList.svelte'

/**
 * The parts of a settings card, used as `SettingsList.Root` (the card, with its heading),
 * `SettingsList.Row` (a label and a control), `SettingsList.Value` (a label and a read-only
 * value), and `SettingsList.Action` (a destructive action that asks first).
 */
export { Root, Row, Value, Action }
