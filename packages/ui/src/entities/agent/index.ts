/**
 * The agent entity: its avatar, a bird in a circle tinted with its color, and the shared
 * birdhouse it lives in.
 *
 * @see design/components/AgentAvatar
 * @module
 */

/** The agent's face: a bird in a tinted circle, or its birdhouse while it sleeps or is paused. */
export { default as AgentAvatar } from './ui/AgentAvatar.svelte'
/** The shared birdhouse of the workspace, gray with a flag in the agent's color. */
export { default as Birdhouse } from './ui/Birdhouse.svelte'
/** The avatar's vocabulary: colors, poses, props, and how each pose is drawn. */
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
} from './model/avatar.js'
