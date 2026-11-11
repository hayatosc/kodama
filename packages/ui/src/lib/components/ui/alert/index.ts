/**
 * Alert in the shape of shadcn-svelte's: a message in the page with an optional icon.
 *
 * @module
 */

import Description from './alert-description.svelte'
import Title from './alert-title.svelte'
import Root from './alert.svelte'

/** The parts of an alert, used as `Alert.Root`, `Alert.Title`, and `Alert.Description`. */
export { Root, Title, Description }
/** The alert's class builder and tone names. */
export { alertVariants, type AlertVariant } from './variants.js'
