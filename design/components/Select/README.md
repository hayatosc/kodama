# Select

An input that picks one option, made of a closed trigger and an open menu. Used to choose providers and models; both menus have a search field.

- **What the caller passes:** the options (label, group), the current value, a change handler, and the search placeholder.
- **Trigger (form):** `h-9 min-w-[220px] rounded-lg border border-input bg-background px-2.5 text-sm`, with `chevron-down` at the right (`text-muted-foreground`). Shows the focus ring while open.
- **Trigger (inside a settings list):** an outlined `kd-select` (`h-7 rounded-md text-sm`, `bg-accent` on hover), placed at the right edge of the row.
- **Menu:** `bg-popover border rounded-xl shadow-lg p-1`, minimum width 220px.
  - A search field at the top (magnifier and input, 1px line below). Opening focuses the search; typing filters by label. When nothing matches, show 「一致するものがありません」 ("No matches").
  - Options scroll at a maximum height of 260px. Each item is `min-h-9 px-2 py-1.5 rounded-md text-sm`; hover and the selected item use `bg-accent`, and the selected item shows `check` at the right.
  - Group headings (for models, 「最新」 (Latest) and 「以前のモデル」 (Older models)) use `text-xs text-muted-foreground`.
- The provider menu lists provider names only. The model menu lists only the selected provider's models, in `font-mono`.
- **Actions:** press the trigger to open. Choose with a click, or press Enter in the search field (the first match). Esc or a click outside closes.
- The implementation is shadcn-svelte's Combobox (bits-ui Combobox).
