# WorkspaceLive

The same screen as Workspace, with buttons that trigger events so you can watch the bird's behavior end to end. The same screen in light and dark is stacked vertically, and the shared buttons at the top drive both at once.

- **What the caller passes:** nothing in the implementation. Each pose and motion rule lives in AgentAvatar; this screen shows how they look in the sidebar, in the thinking pill, and at the edge of the input.
- The top bar streams the real event names that correspond to the motions (`tool_execution_start`, `kodama.agent-message`, and so on).
- Motions that can only be shown on screen, such as a letter or bookmark flying from row to row or the main agent peeking over the input, live here.
