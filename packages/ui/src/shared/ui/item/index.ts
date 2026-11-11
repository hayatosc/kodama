/**
 * Item in the shape of shadcn-svelte's: a row with media, a title and description, and actions.
 *
 * @module
 */

import Actions from './item-actions.svelte'
import Content from './item-content.svelte'
import Description from './item-description.svelte'
import Group from './item-group.svelte'
import Media from './item-media.svelte'
import Title from './item-title.svelte'
import Root from './item.svelte'

/** The parts of an item row, used as `Item.Root`, `Item.Title`, …; Group lists items. */
export { Root, Media, Content, Title, Description, Actions, Group }
/** The item's class builder and its look and density names. */
export { itemVariants, type ItemSize, type ItemVariant } from './variants.js'
