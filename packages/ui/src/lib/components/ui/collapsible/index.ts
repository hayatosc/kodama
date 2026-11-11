/**
 * Collapsible in the shape of shadcn-svelte's, built on <details> and <summary>.
 *
 * @module
 */

import Content from './collapsible-content.svelte'
import Trigger from './collapsible-trigger.svelte'
import Root from './collapsible.svelte'

/** The parts of a collapsible section: Root is the <details>, Trigger its <summary>. */
export { Root, Trigger, Content }
