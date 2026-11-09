# Workspace

The whole screen with Sidebar, conversation, and ProfilePanel, shown as the same screen in light and dark stacked vertically.

- **What the caller passes:** the root `+layout.svelte` holds Sidebar and ProfilePanel; the `/` (main) and `agents/[slug]` pages draw the center conversation.
- Columns are `grid-cols-[280px_1fr_320px]`. Below 1280px the right pane collapses and opens from the details button (`info`) at the upper right of the center pane. Below 1024px it switches to the phone's single pane (Mobile).
- The center pane has no header bar. The selected row in the sidebar and the right pane show who you are talking to, leaving the conversation surface wide.
- The Composer floats at the bottom of the center pane; the conversation scrolls beneath it.
