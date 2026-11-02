# Tabs

右ペインのタブで、エージェントの「詳細・記憶・ツール」を切り替える。タブごとに中身の型が決まっている。

- **使う側が渡すもの:** 選択中のタブ、各タブの中身（詳細＝設定リスト、記憶＝記憶の一覧と検索、ツール＝ツールの一覧とスイッチ）、変更時のハンドラ。
- **タブ:** `role="tablist"`。各タブは `h-8 px-3 rounded-md text-sm font-semibold`、選択中は `bg-muted text-foreground`、それ以外は `text-muted-foreground`（ホバーで `text-foreground`）。左右キーで移動。
- **詳細:** SettingsList（プロバイダー・モデル）とルーティン、アクティビティ。
- **記憶:** 上に検索欄（`border-input` の枠、虫眼鏡）。各項目は種類のバッジ（事実・好み・手順）、出どころと日付（`text-xs text-muted-foreground`）、本文（`text-sm`）。ホバーで `bg-accent`、押すと編集・削除のメニュー。
- **ツール:** 各行はツール名（`font-mono font-semibold`）、説明（`text-xs text-muted-foreground`）、右端に Switch。システムが管理するツールは disabled。
- **操作:** タブをクリックするとパネルが切り替わる（`aria-selected`）。
- 実装は shadcn-svelte の Tabs（bits-ui）。
