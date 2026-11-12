/**
 * Callout in the shape of shadcn-svelte's Alert: a message in the page with an optional icon.
 *
 * @module
 */

import Description from './CalloutDescription.svelte'
import Title from './CalloutTitle.svelte'
import Root from './Callout.svelte'

/** The parts of a callout, used as `Callout.Root`, `Callout.Title`, and `Callout.Description`. */
export { Root, Title, Description }
/** The callout's class builder and tone names. */
export { calloutVariants, type CalloutVariant } from './variants.js'
