# ActivityFeed

A vertical timeline with times, showing what agents did while nobody was watching.

- **What the caller passes:** an array of events (time, kind, the subject to bold, supporting text). Kinds are alarms, cron, exchanges with other agents, memory extraction, configuration application, failures, and run start/end.
- Three columns: a right-aligned time (`font-mono text-xs text-muted-foreground`), a node (a dot or a 16px icon), and the body (the subject is `font-semibold text-foreground`; supporting text is `text-muted-foreground`).
- Connect nodes with a vertical 1px `border` line. An in-progress event uses the running dot; a failure uses the destructive dot and subject.
- Newest first, from the top. Today shows `09:00`; earlier shows 「昨日」 (Yesterday) or 「10/28」.
- In the right pane, narrow the width and make the time column 44px.
