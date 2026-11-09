# Kbd

Key hints for keyboard operations.

- **What the caller passes:** the key text (`Tab`, `⏎`, `⇧ ⏎`, `Esc`, `⌘ K`) and the explanation next to it.
- Shape: `min-w-[22px] h-5 px-1.5 border rounded-sm`, 2px on the bottom edge only, `bg-background font-mono text-[11px]`.
- The explanation is `text-xs text-muted-foreground`, to the right of the key. When showing several, separate them with a 1px divider.
- Show `⌘` on Mac and `Ctrl` elsewhere.
