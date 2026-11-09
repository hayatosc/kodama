# Button

A button that starts an action. The primary action uses the inverted primary style; everything else uses secondary or ghost.

- **What the caller passes:** `variant` (primary / secondary / ghost / destructive), `size` (default 36px / sm 32px / icon 36px / round 36px), and a label or icon. Icon-only buttons must have an `aria-label`.
- At most one primary per surface. In the conversation pane, the Composer's send and stop buttons are it.
- destructive uses `destructive` text on a `destructive-soft` background. Archive and delete go through a confirmation dialog.
- Labels end with a verb (作成, 送信, 停止 — create, send, stop).

```svelte
<Button>新しいエージェント</Button>          <!-- bg-primary text-primary-foreground shadow-sm rounded-lg h-8 px-3 -->
<Button variant="secondary">設定を開く</Button> <!-- border border-input bg-background hover:bg-accent -->
<Button variant="ghost" size="icon" aria-label="検索"><Search /></Button>
<Button size="round" aria-label="送信"><ArrowUp /></Button> <!-- rounded-full size-8 -->
```

- **Round button (`circle`):** `size-8 rounded-full border bg-background`. Used for search and create at the top of the sidebar and share in the right pane.
- **Chip (`chip`):** `h-7 rounded-full px-2 text-xs text-muted-foreground`; on hover `bg-accent text-foreground`. For small actions that should blend into the surface, such as attachments in the Composer. Icon-only chips use `w-8`.
