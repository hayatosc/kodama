# Select

選択肢から 1 つを選ぶ入力で、閉じたトリガーと開いたメニューからなる。プロバイダーとモデルの選択に使い、どちらのメニューにも検索欄を付ける。

- **使う側が渡すもの:** 選択肢（ラベル、グループ）、現在の値、変更時のハンドラ、検索欄のプレースホルダー。
- **トリガー（フォーム）:** `h-9 min-w-[220px] rounded-lg border border-input bg-background px-2.5 text-sm`、右端に `chevron-down`（`text-muted-foreground`）。開いている間はフォーカスリング。
- **トリガー（設定リストの中）:** 枠なしの `kd-select`（`h-7 rounded-md text-sm`、ホバーで `bg-accent`）。行の右端に置く。
- **メニュー:** `bg-popover border rounded-xl shadow-lg p-1`、最小幅 220px。
  - 上端に検索欄（虫眼鏡と入力、下に 1px の線）。開くと検索欄にフォーカスし、入力するとラベルで絞り込む。一致しないときは「一致するものがありません」。
  - 選択肢は最大 260px でスクロール。各項目は `min-h-9 px-2 py-1.5 rounded-md text-sm`、ホバーと選択中は `bg-accent`、選択中は右端に `check`。
  - グループ見出し（モデルなら「最新」「以前のモデル」）は `text-xs text-muted-foreground`。
- プロバイダーのメニューにはプロバイダー名だけを並べる。モデルのメニューには選んでいるプロバイダーのモデルだけを、`font-mono` で並べる。
- **操作:** トリガーを押して開く。項目のクリックか、検索欄で Enter（先頭の候補）で決定。Esc か外側のクリックで閉じる。
- 実装は shadcn-svelte の Combobox（bits-ui の Combobox）。
