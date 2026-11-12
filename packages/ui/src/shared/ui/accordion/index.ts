/**
 * Accordion in the shape of shadcn-svelte's, built on <details> and <summary>.
 *
 * @module
 */

import Content from './AccordionContent.svelte'
import Item from './AccordionItem.svelte'
import Trigger from './AccordionTrigger.svelte'
import Root from './Accordion.svelte'

/**
 * The parts of an accordion: Root groups Items; each Item is a <details> with a Trigger and
 * Content. An Item without a Root is one section that opens and closes.
 */
export { Root, Item, Trigger, Content }
