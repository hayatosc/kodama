/**
 * Item in the shape of shadcn-svelte's: a row with media, a title and description, and actions.
 *
 * @module
 */

import Actions from './ItemActions.svelte'
import Content from './ItemContent.svelte'
import Description from './ItemDescription.svelte'
import Group from './ItemGroup.svelte'
import Media from './ItemMedia.svelte'
import Title from './ItemTitle.svelte'
import Root from './Item.svelte'

/** The parts of an item row, used as `Item.Root`, `Item.Title`, …; Group lists items. */
export { Root, Media, Content, Title, Description, Actions, Group }
/** The item's class builder and its look and density names. */
export { itemVariants, type ItemSize, type ItemVariant } from './variants.js'
