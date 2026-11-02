# Sidebar

左ペインのエージェント一覧で、メインのエージェントを最上部の特別枠に置き、他のエージェントを顔と最後の出来事で並べる。

- **使う側が渡すもの:** `main`（メインのエージェント）、`agents`（他の working agent。`AgentSummary` に最後の出来事の要約・時刻・未読数・アバター設定を足したもの）、`system`（専用エージェント）、選択中の `slug`。
- **メインの行:** 一覧の最上部に置き、別のカードには載せない。ほかの行と同じく面の上に直接置き、アバター 56px、「メイン」の小見出し、名前（`font-display text-lg font-semibold`）、状態の語＋今していること。ホバーで `bg-accent`、選択中は `bg-muted`。
- **一覧の行:** アバター 36px、名前（`font-semibold`）、右端に相対時刻か未読数（`bg-live` の丸いカウント）、2 行目に `text-sm text-muted-foreground` で最後の出来事。選択中 `bg-muted`、ホバー `bg-accent`、`rounded-xl`。
- システム用エージェント（`kind = 'dedicated'`）は「システム」見出しの下に、灰色のアバターと `font-mono` の名前で。
- 並び順は手動ピン留め → 実行中 → 最終活動の新しい順。
- **操作:** 行をクリックで選択（`aria-current`）。
- 上端は右寄せの丸ボタン（検索、新規作成）、下端は自分のアカウント。幅 280px、背景 `bg-sidebar`。
