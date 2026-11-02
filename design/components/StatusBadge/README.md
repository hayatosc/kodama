# StatusBadge

エージェントのライフサイクルと run の状態を、ドットと語の組で示す。

- **使う側が渡すもの:** `status`（live / running / queued / paused / error / done / archived）、任意のラベル。ラベルを省くと既定の語（稼働中、実行中…）を出す。
- 色だけで区別しない。ドットの形（塗り・中抜きの円・中抜きの角）と語が必ず付く。
- 一覧の行ではドットだけ、ペイン見出しや詳細パネルではバッジ（地付き）を使う。
- running のドットは点滅し、`prefers-reduced-motion` では止める。
- `AgentStatus` との対応: active → live、provisioning / pausing → running、paused → paused、archived / deleted → archived、deleting → error。

```svelte
<StatusBadge status="running" />  <!-- inline-flex h-[22px] gap-1.5 rounded-md bg-running-soft px-2 text-xs font-semibold text-running -->
```

- **未読数（`count`）:** `min-w-[18px] h-[18px] rounded-full bg-live px-[5px] text-[11px] font-semibold text-primary-foreground`。サイドバーの行の右端に置き、0 なら出さない。99 を超えたら「99+」。
