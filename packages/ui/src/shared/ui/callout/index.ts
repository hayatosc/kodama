/**
 * Callout in the shape of shadcn-svelte's Alert: a message in the page with an optional icon.
 *
 * @module
 */

import Description from './callout-description.svelte'
import Title from './callout-title.svelte'
import Root from './callout.svelte'

/** The parts of a callout, used as `Callout.Root`, `Callout.Title`, and `Callout.Description`. */
export { Root, Title, Description }
/** The callout's class builder and tone names. */
export { calloutVariants, type CalloutVariant } from './variants.js'
