/**
 * Accordion in the shape of shadcn-svelte's, built on <details> and <summary>.
 *
 * @module
 */

import Content from './accordion-content.svelte'
import Item from './accordion-item.svelte'
import Trigger from './accordion-trigger.svelte'
import Root from './accordion.svelte'

/**
 * The parts of an accordion: Root groups Items; each Item is a <details> with a Trigger and
 * Content. An Item without a Root is one section that opens and closes.
 */
export { Root, Item, Trigger, Content }
