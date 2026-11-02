# ToolCall

エージェントのツール実行を 1 行に畳んだアコーディオン。開くと引数と結果を見せる。

- **使う側が渡すもの:** ツール名、1 行の要約（件数、クエリ、相手のエージェント名）、所要時間、状態（running / done / error）、引数（JSON）、結果（テキストか JSON）、結果の大きさ。
- **閉じた行:** `chevron-right` · 名前（`font-semibold text-foreground`）· 要約（`text-muted-foreground`）· 右端に所要時間（`font-mono text-xs`）。行全体が開閉ボタン（`aria-expanded`）。開くと chevron が 90° 回る（150ms）。
- **開いた中身:** `border rounded-lg bg-card` の箱。
  - 上段「引数」：小見出し（`text-xs text-muted-foreground`）と右端の「コピー」。JSON はキー＝`live`、文字列＝`running`、数値＝`destructive`、コメント＝`muted-foreground` で色分けした `font-mono text-sm`。
  - 下段「結果 · n 件 / 2.4 KB」：`bg-muted` の帯。本文は `text-muted-foreground`。
  - 結果が 5 行を超えたら 104px で切り、下をフェードさせて「すべて表示」（ghost の小ボタン）。押すと全文を出す。
- **実行中:** chevron の代わりに running のドット。中身の下段は「返事を待っています · 12s」と箱の下端いっぱいに 2px の不定形のプログレスバー（`muted-foreground`。エージェントの色や状態色は使わない）。所要時間は数え上げる。
- **失敗:** 名前と時間を `text-destructive`。下段は `bg-destructive-soft` に「エラー」と、ツールが返したエラーをそのまま 1 行で（例: `403 Forbidden`）。説明文は足さない。
- 既定は閉じた状態。失敗したものだけは最初から開いておいてもよい。
- **操作:** 行をクリックか Enter / Space で開閉。「すべて表示」で全文、もう一度押すと「折りたたむ」。「コピー」は押すと 1.4 秒「コピーしました」に変わる。
- 実装は bits-ui の Collapsible。`tool_execution_start` / `_update` / `_end` で状態と結果を更新する。
