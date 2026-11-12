/**
 * Tooltip in the shape of shadcn-svelte's, built on interest invokers (`interestfor`) and a hint
 * popover. The interestfor polyfill loads only where interest invokers are missing.
 *
 * @module
 */

import Content from './TooltipContent.svelte'
import Trigger from './TooltipTrigger.svelte'
import Root from './Tooltip.svelte'

/** The parts of a tooltip, used as `Tooltip.Root`, `Tooltip.Trigger`, and `Tooltip.Content`. */
export { Root, Trigger, Content }
