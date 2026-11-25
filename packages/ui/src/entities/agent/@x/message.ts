/**
 * What the message entity may use of the agent entity: the avatar, for a peer message's sender.
 * Feature-Sliced Design keeps entities from importing each other except through an `@x` file
 * named after the consumer.
 *
 * @module
 */

/** The agent's face, shown at 20px beside a peer message's sender. */
export { default as AgentAvatar } from '../ui/AgentAvatar.svelte'
/** The sender's color and what its avatar is doing. */
export type { AgentColor, AgentPose } from '../model/avatar.js'
