/**
 * The profile panel: an agent's profile in the right pane.
 *
 * @see design/components/ProfilePanel
 * @module
 */

/** Who the agent is, what runs it, what it remembers, and which tools it may use. */
export { default as ProfilePanel } from './ui/ProfilePanel.svelte'
/** The panel's data, the memory kinds' words, and the memory search and date. */
export {
  MEMORY_KIND_WORDS,
  filterMemories,
  formatMemoryDate,
  type AgentTool,
  type MemoryItem,
  type MemoryKind,
  type ProfileAgent,
  type Routine,
} from './model/profile.js'
