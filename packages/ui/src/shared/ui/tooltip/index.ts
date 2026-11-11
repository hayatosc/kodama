/**
 * Tooltip in the shape of shadcn-svelte's, built on interest invokers (`interestfor`) and a hint
 * popover. The interestfor polyfill loads only where interest invokers are missing.
 *
 * @module
 */

import Content from './tooltip-content.svelte'
import Trigger from './tooltip-trigger.svelte'
import Root from './tooltip.svelte'

/** The parts of a tooltip, used as `Tooltip.Root`, `Tooltip.Trigger`, and `Tooltip.Content`. */
export { Root, Trigger, Content }
