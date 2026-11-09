# StatusBadge

Shows an agent's lifecycle and run state as a dot and a word.

- **What the caller passes:** `status` (live / running / queued / paused / error / done / archived) and an optional label. Without a label, show the default word (稼働中, 実行中, … — active, running, …).
- Never distinguish by color alone. The dot's shape (filled, hollow circle, hollow square) and the word are always present.
- List rows use the dot only; pane headings and the detail panel use the badge (with a background).
- The running dot blinks; stop it under `prefers-reduced-motion`.
- Mapping to `AgentStatus`: active → live, provisioning / pausing → running, paused → paused, archived / deleted → archived, deleting → error.

```svelte
<StatusBadge status="running" />  <!-- inline-flex h-[22px] gap-1.5 rounded-md bg-running-soft px-2 text-xs font-semibold text-running -->
```

- **Unread count (`count`):** `min-w-[18px] h-[18px] rounded-full bg-live px-[5px] text-[11px] font-semibold text-primary-foreground`. Place it at the right edge of a sidebar row; hide it when 0. Above 99, show 「99+」.
