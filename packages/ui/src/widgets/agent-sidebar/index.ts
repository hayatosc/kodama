/**
 * The agent sidebar: the list of agents in the left pane.
 *
 * @see design/components/Sidebar
 * @module
 */

/** The left pane's list: the main agent, the working agents, and the system agents. */
export { default as Sidebar } from './ui/Sidebar.svelte'
/** One listed agent, the sidebar's order, and how a row writes its time and unread count. */
export { formatRelativeTime, formatUnread, sortAgents, type SidebarAgent } from './model/sidebar.js'
