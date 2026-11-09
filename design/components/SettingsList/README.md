# SettingsList

A settings card that stacks label/value rows. Used for 「ルーティン」 (Routines) and 「設定」 (Settings) in the right pane, and on settings pages.

- **What the caller passes:** an array of rows. Each row has a label (with optional supporting text) and one component at the right edge (a value, Select, Switch, or action).
- The box is `border rounded-xl py-1`; rows are `min-h-10 px-3 text-sm`, separated by 1px `border`.
- **Right-edge components:** a read-only value is `font-mono text-sm text-muted-foreground`. A choosable value is an outlined Select (with search). On/off is a Switch.
- **Rows with supporting text:** one sentence under the label in `text-xs text-muted-foreground`.
- **Destructive actions:** `text-destructive` text with an icon at the right edge. Pressing it opens a confirmation dialog (Dialog). Place it at the end of the card.
- Above the box, place a section heading in `text-xs text-muted-foreground` (「設定」 (Settings), 「ルーティン」 (Routines)).
