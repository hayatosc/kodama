/**
 * The message entity: the parts a conversation is made of, from the user's pill to a folded tool
 * call, and the look of the Markdown inside a reply.
 *
 * @see design/components/Message
 * @module
 */

/** One utterance: the user's pill, a thinking pill, the agent's bubble, or a peer agent's message. */
export { default as Message } from './ui/Message.svelte'
/** The look of Markdown rendered inside a reply, with a caret while it streams. */
export { default as Prose } from './ui/Prose.svelte'
/** A fenced code block inside Prose, with its language and a copy button. */
export { default as ProseCodeBlock } from './ui/ProseCodeBlock.svelte'
/** A table inside Prose, scrolling sideways when it is wider than the bubble. */
export { default as ProseTable } from './ui/ProseTable.svelte'
/** One tool execution folded into a row that opens to its arguments and result. */
export { default as ToolCall } from './ui/ToolCall.svelte'
/** Who sent a peer message, and where a tool call is. */
export type { PeerSender, ToolCallState } from './model/message.js'
/** Duration text and one-line JSON, as the tool call shows them. */
export { formatDuration, formatElapsed, jsonTokens, type JsonToken } from './model/format.js'
