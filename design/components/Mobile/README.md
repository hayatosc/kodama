# Mobile

A phone-width (375px) screen that switches between the list, the conversation, and details one at a time. It is the desktop three panes rearranged vertically, reusing the same components.

- **List:** a large 「Kodama」 heading at the top (`font-display text-[28px] font-semibold`) plus round search and create buttons. The content matches Sidebar: the main row at the top, avatars 40px. Tapping a row opens the conversation.
- **Conversation:** a 56px app bar at the top (back, 32px avatar, name and 「状態 · 今していること」 (state · current activity), details button). The body reuses Message and ToolCall as-is; the user's pill is at most 85%. Place the Composer at the bottom with 12px side margins.
- **Queue:** phones have no Tab key, so typing during a run shows an 「キューに追加」 (Add to queue) button in the sheet (Composer's `mobile`). The send button steers the run.
- **Details:** the app bar's details button opens a sheet from the bottom (20px radius, grab handle at the top, 32% black scrim). The content is ProfilePanel's tabs. Selects inside the sheet open their menu upward. Close with the scrim, ×, or Esc.
- The input is 16px (to prevent iOS zoom). Add the home indicator's inset at the bottom (`env(safe-area-inset-bottom)`).
- Below 1024px is a single pane switching between list and conversation; 1024–1279px is list plus conversation; 1280px and above is three panes.
