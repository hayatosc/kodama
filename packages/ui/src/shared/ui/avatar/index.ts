/**
 * Avatar in the shape of shadcn-svelte's: a person's picture with initials as the fallback.
 * Agents get their own bird avatar in a later stage.
 *
 * @module
 */

import Fallback from './avatar-fallback.svelte'
import Image from './avatar-image.svelte'
import Root from './avatar.svelte'

/** The parts of an avatar, used as `Avatar.Root`, `Avatar.Image`, and `Avatar.Fallback`. */
export { Root, Image, Fallback }
