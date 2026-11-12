/**
 * InputGroup in the shape of shadcn-svelte's: an input with icons, text, or buttons inside one
 * border.
 *
 * @module
 */

import Addon from './InputGroupAddon.svelte'
import Button from './InputGroupButton.svelte'
import Input from './InputGroupInput.svelte'
import Text from './InputGroupText.svelte'
import Root from './InputGroup.svelte'

/** The parts of an input group, used as `InputGroup.Root`, `InputGroup.Input`, …. */
export { Root, Input, Addon, Button, Text }
