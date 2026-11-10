/**
 * The agent avatar: a bird in a tinted circle, or its birdhouse while it sleeps.
 *
 * @see design/components/AgentAvatar
 * @module
 */

export { default as AgentAvatar } from './AgentAvatar.svelte'
export { default as Bird } from './Bird.svelte'
export { default as Birdhouse } from './Birdhouse.svelte'
export {
  POSES,
  WORKING_COLORS,
  badgeOf,
  defaultProp,
  isHome,
  scaleOf,
  type AgentColor,
  type AgentPose,
  type AgentProp,
} from './avatar.js'
