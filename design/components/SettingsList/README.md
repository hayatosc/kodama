# SettingsList

ラベルと値を 1 行ずつ並べる設定のカード。右ペインの「ルーティン」「設定」や、設定ページで使う。

- **使う側が渡すもの:** 行の配列。各行はラベル（必要なら補足）と、右端の部品 1 つ（値・Select・Switch・操作）。
- 箱は `border rounded-xl py-1`、行は `min-h-10 px-3 text-sm`、行の間に 1px の `border`。
- **右端の部品:** 読むだけの値は `font-mono text-sm text-muted-foreground`。選ぶ値は枠なしの Select（検索つき）。オンオフは Switch。
- **補足つきの行:** ラベルの下に `text-xs text-muted-foreground` で一文。
- **破壊的な操作:** 文字を `text-destructive` にし、右端にアイコン。押すと確認ダイアログ（Dialog）を出す。カードの最後に置く。
- 箱の上には `text-xs text-muted-foreground` のセクション見出し（「設定」「ルーティン」）を置く。
