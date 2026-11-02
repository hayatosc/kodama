# Dialog

元に戻しにくい操作の前に出す確認ダイアログ。

- **使う側が渡すもの:** 題（「〜しますか？」）、何が起きるかの説明、確定ボタンのラベル（動詞）、キャンセルと確定のハンドラ。
- 背景は黒 32% のスクリム。箱は `w-[400px] p-6 bg-popover border rounded-xl shadow-lg`。
- 題は `font-display text-lg font-semibold`。説明は `text-base text-muted-foreground` で、失うもの・残るもの・戻せるかを書く。
- ボタンは右寄せで、キャンセル（secondary）→ 確定の順。破壊的な確定は `bg-destructive` の塗り（ダークでは文字を黒に）。
- `role="alertdialog"`。開いたらキャンセルにフォーカス、Esc とスクリムのクリックでキャンセル。
- 実装は shadcn-svelte の AlertDialog（bits-ui）。
