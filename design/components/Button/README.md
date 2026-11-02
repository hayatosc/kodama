# Button

操作を起こすボタンで、主操作は反転色の primary、それ以外は secondary か ghost を使う。

- **使う側が渡すもの:** `variant`（primary / secondary / ghost / destructive）、`size`（default 36px / sm 32px / icon 36px / round 36px）、ラベルかアイコン。アイコンだけのボタンには `aria-label` を必ず付ける。
- 1 つの面に primary は 1 つまで。会話ペインでは Composer の送信・停止ボタンがそれにあたる。
- destructive は `destructive-soft` 地に `destructive` 文字。アーカイブや削除は確認ダイアログを挟む。
- ラベルは動詞で終える（作成、送信、停止）。

```svelte
<Button>新しいエージェント</Button>          <!-- bg-primary text-primary-foreground shadow-sm rounded-lg h-8 px-3 -->
<Button variant="secondary">設定を開く</Button> <!-- border border-input bg-background hover:bg-accent -->
<Button variant="ghost" size="icon" aria-label="検索"><Search /></Button>
<Button size="round" aria-label="送信"><ArrowUp /></Button> <!-- rounded-full size-8 -->
```

- **丸ボタン（`circle`）:** `size-8 rounded-full border bg-background`。サイドバー上端の検索・新規作成、右ペインの共有に使う。
- **チップ（`chip`）:** `h-7 rounded-full px-2 text-xs text-muted-foreground`、ホバーで `bg-accent text-foreground`。Composer の添付など、面に溶け込ませたい小さな操作に使う。アイコンだけのときは `w-8`。
