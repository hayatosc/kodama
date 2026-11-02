# Kbd

キーボード操作のヒントに使うキー表示。

- **使う側が渡すもの:** キーの文字（`Tab`、`⏎`、`⇧ ⏎`、`Esc`、`⌘ K`）と、隣に置く説明。
- 形は `min-w-[22px] h-5 px-1.5 border rounded-sm`、下辺だけ 2px、`bg-background font-mono text-[11px]`。
- 説明は `text-xs text-muted-foreground` で、キーの右に置く。複数並べるときは 1px の区切り線を挟む。
- Mac では `⌘`、それ以外では `Ctrl` と表示する。
