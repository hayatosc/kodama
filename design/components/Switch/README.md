# Switch

オンとオフを即座に切り替えるスイッチ。ツールの有効・無効に使う。

- **使う側が渡すもの:** `checked`、`disabled`、変更時のハンドラ、ラベル（隣の文字か `aria-label`）。
- 形は `w-[34px] h-5 rounded-full`。オフは `bg-input`、オンは `bg-primary`（反転色）。つまみは 16px の円で、オフは `bg-background`、オンは `bg-primary-foreground`。150ms で移動する。
- `role="switch"` と `aria-checked`。Space で切り替え。disabled は 40% の不透明度で、理由を行の説明に書く。
- 押した瞬間に反映する設定にだけ使う。保存ボタンが必要な設定にはチェックボックスを使う。
- 実装は shadcn-svelte の Switch（bits-ui）。
