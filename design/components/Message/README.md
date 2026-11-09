# Message

One utterance in the conversation; four kinds are distinguished by shape: the user's pill, the thinking pill, the agent's bubble, and a message from another agent.

- **What the caller passes:** `role` (user / assistant / thinking / peer); the body (Markdown already rendered); for peer, the sender's avatar settings, `slug`, UUID, and hop count.
- user: right-aligned, at most 70%, `bg-primary text-primary-foreground font-semibold`, `rounded-full` for one line and `rounded-[20px]` for multiple lines.
- thinking: one sentence about the work, `bg-muted rounded-2xl px-3.5 py-1.5`. Only the latest one shows a three-dot typing indicator at its end.
- assistant: `bg-muted rounded-2xl px-3.5 py-2.5`, at most 560px, body `text-base leading-7` (16/28). Headings are bold paragraphs; lists use `list-disc pl-5`.
- The conversation is with one agent, so agent bubbles carry no name or avatar (the screen's context says who is speaking). Only peer messages from other agents show a name.
- peer (`kodama.agent-message`): `bg-background border rounded-2xl`; the header shows the sender's 18px avatar, name, first 8 UUID characters (`font-mono`), and hop count.
- A snapshot replaces the whole list of utterances.
