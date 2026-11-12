/**
 * The agent avatar's vocabulary: colors, poses, props, and how each pose is drawn.
 *
 * Poses come from the event stream (design/components/AgentAvatar — the table of events); the
 * avatar itself keeps no state.
 *
 * @module
 */

/** The 11 working-agent colors, in hue order. */
export const WORKING_COLORS = [
  'orange',
  'yellow',
  'green',
  'teal',
  'sky',
  'blue',
  'violet',
  'plum',
  'pink',
  'red',
  'brown',
] as const

/** An agent's color: a working color, `ink` for the main agent, or `system` for dedicated ones. */
export type AgentColor = (typeof WORKING_COLORS)[number] | 'ink' | 'system'

/** Every pose, in the order of the design's event table. */
export const POSES = [
  'idle',
  'listen',
  'work',
  'write',
  'happy',
  'live',
  'tilt',
  'surprised',
  'stretch',
  'worried',
  'error',
  'sleep',
  'paused',
] as const

/** What the agent is doing now; `sleep` and `paused` draw the birdhouse instead of the bird. */
export type AgentPose = (typeof POSES)[number]

/** Something the bird holds: a magnifier, a pen over a sheet, or a letter. */
export type AgentProp = 'lens' | 'pen' | 'letter'

/** The eye shapes the poses use. */
export type EyeKind = 'open' | 'closed' | 'happy' | 'wide' | 'cross' | 'worried'

/** The prop a pose holds unless the caller says otherwise. */
export function defaultProp(pose: AgentPose): AgentProp | undefined {
  if (pose === 'work') return 'lens'
  if (pose === 'write') return 'pen'
  return undefined
}

/** The eyes for a pose. */
export function eyesOf(pose: AgentPose): EyeKind {
  if (pose === 'sleep' || pose === 'paused') return 'closed'
  if (pose === 'happy' || pose === 'live') return 'happy'
  if (pose === 'surprised') return 'wide'
  if (pose === 'error') return 'cross'
  if (pose === 'worried') return 'worried'
  return 'open'
}

/** Whether a pose raises the wings (and so needs room above the bird). */
export function liftsWings(pose: AgentPose): boolean {
  return pose === 'happy' || pose === 'live' || pose === 'stretch'
}

/** The bird's scale inside the circle, small enough that no pose clips its wings or tail. */
export function scaleOf(pose: AgentPose): number {
  if (liftsWings(pose)) return 0.84
  if (pose === 'listen') return 0.85
  if (pose === 'tilt') return 0.8
  return 0.93
}

/** The lower-right badge a pose shows: blue for a reply, red for trouble. */
export function badgeOf(pose: AgentPose): 'live' | 'error' | undefined {
  if (pose === 'live') return 'live'
  if (pose === 'error' || pose === 'worried') return 'error'
  return undefined
}

/** Whether the avatar draws the birdhouse rather than the bird. */
export function isHome(pose: AgentPose): boolean {
  return pose === 'sleep' || pose === 'paused'
}
