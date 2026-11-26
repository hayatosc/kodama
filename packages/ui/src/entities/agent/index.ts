/**
 * The agent entity: its avatar, a bird in a circle tinted with its color, the shared birdhouse
 * it lives in, and its run state as a status badge.
 *
 * @see design/components/AgentAvatar
 * @see design/components/StatusBadge
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
  type AgentMark,
  type AgentPose,
  type AgentProp,
} from './model/avatar.js'
/** An agent's run state as a dot and a word, or the dot alone in list rows. */
export { default as StatusBadge } from './ui/StatusBadge.svelte'
/** The run states, their words, and how a registry lifecycle state maps onto one. */
export {
  RUN_STATES,
  STATUS_WORDS,
  runStateOf,
  type AgentLifecycle,
  type RunState,
} from './model/status.js'
