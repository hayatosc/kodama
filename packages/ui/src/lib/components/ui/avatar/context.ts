/**
 * The state an avatar shares with its image and fallback: whether the image has loaded.
 *
 * @module
 */

import { createContext } from 'svelte'

/** Shared by Avatar.Root with its Image and Fallback. */
export type AvatarState = {
  status: 'loading' | 'loaded' | 'error'
  /** Whether an Avatar.Image is rendered, which then names the avatar. */
  hasImage: boolean
}

/** Reads and provides the state of the nearest Avatar.Root. */
export const [getAvatarState, setAvatarState] = createContext<AvatarState>()
