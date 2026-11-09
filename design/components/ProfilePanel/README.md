# ProfilePanel

The agent's profile in the right pane: who it is, what runs it, and what it has done, stacked vertically.

- **What the caller passes:** the agent (name, avatar, state), routines (cron and alarms), settings (provider, model), and activity.
- Top to bottom: a large avatar (72px) with the name and status badge; tabs (Details / Memory / Tools); section headings (`text-xs text-muted-foreground`); settings cards (`border rounded-xl`, 40px rows, a small searchable select at the right edge).
- The selected tab is `bg-muted rounded-md`. Selects have no outline and show `bg-accent` only on hover.
- Activity is a compact ActivityFeed (44px time column).
- 320px wide with `border-l`. Below 1280px it collapses and opens from the details button (`info`) at the upper right of the center pane. Below 1024px it becomes Mobile's details sheet.
