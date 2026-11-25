/**
 * Composing a message: the input at the bottom of a conversation, with the queue that holds
 * messages until the agent's run ends.
 *
 * @see design/components/Composer
 * @module
 */

/** The pill-shaped input: Enter sends, and while the agent runs, Tab queues. */
export { default as Composer } from './ui/Composer.svelte'
