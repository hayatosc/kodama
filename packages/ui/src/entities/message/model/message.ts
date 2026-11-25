/**
 * The shapes the conversation parts take: who sent a peer message, and the states of a tool call.
 *
 * @module
 */

import type { AgentColor, AgentPose } from '#entities/agent/@x/message.js'

/** Another agent that wrote into this conversation (`kodama.agent-message`). */
export type PeerSender = {
  /** The sender's slug, shown as its name. */
  slug: string
  /** The sender's agent UUID; the header shows its first 8 characters. */
  agentId: string
  /** How many agents the message passed through before this one. */
  hop: number
  color: AgentColor
  pose?: AgentPose
}

/** Where a tool call is: still waiting, finished with a result, or failed. */
export type ToolCallState = 'running' | 'done' | 'error'
