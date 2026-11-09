# Sidebar

The agent list in the left pane: the main agent in the special slot at the top, and the other agents listed with their faces and latest events.

- **What the caller passes:** `main` (the main agent), `agents` (other working agents; `AgentSummary` plus the latest event summary, time, unread count, and avatar settings), `system` (dedicated agents), and the selected `slug`.
- **Main row:** at the very top of the list, not on a separate card. Like the other rows it sits directly on the surface: a 56px avatar, the small heading 「メイン」 (Main), the name (`font-display text-lg font-semibold`), and the state word plus what it is doing now. Hover is `bg-accent`; selected is `bg-muted`.
- **List rows:** 36px avatar, name (`font-semibold`), and at the right edge a relative time or unread count (a round `bg-live` counter). The second line is the latest event in `text-sm text-muted-foreground`. Selected `bg-muted`, hover `bg-accent`, `rounded-xl`.
- System agents (`kind = 'dedicated'`) sit under a 「システム」 (System) heading with gray avatars and `font-mono` names.
- Order: manual pins → running → most recent activity.
- **Actions:** click a row to select it (`aria-current`).
- The top has right-aligned round buttons (search, create); the bottom is the user's account. 280px wide, `bg-sidebar`.
