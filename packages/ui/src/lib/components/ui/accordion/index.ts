/**
 * Accordion in the shape of shadcn-svelte's, built on <details> and <summary>.
 *
 * @module
 */

import Content from './accordion-content.svelte'
import Item from './accordion-item.svelte'
import Trigger from './accordion-trigger.svelte'
import Root from './accordion.svelte'

/** The parts of an accordion: Root groups Items; each Item is a <details> with a Trigger and Content. */
export { Root, Item, Trigger, Content }
