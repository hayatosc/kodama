# Prose

エージェントの吹き出しの中でレンダリングした Markdown の見た目。

- **使う側が渡すもの:** Markdown の全文と、生成中かどうか。描くのは Streamdown の Svelte 版（SvelteKit の手引きの「Markdown のストリーミング描画」）で、生成中でも閉じていない記法を補って崩さない。モデルの出力を HTML としてそのまま流さない。
- 本文 `text-base leading-7`（16/28）、要素の間は `spacing-2`。
- 生成中は最後のブロックの末尾に点滅するキャレット。コードブロックの色分けはフェンスが閉じてから。
- 見出しは `h3`（18px semibold）と `h4`（16px semibold）だけ。`h1` `h2` は `h3` に落とす。
- リストは `pl-5`、項目の間 2px。リンクは `text-live underline underline-offset-2`。
- インラインコードは `font-mono text-sm bg-accent rounded-sm px-1`。
- コードブロックは `border rounded-lg bg-card`。上に言語名とコピーボタンの帯、本文は ToolCall と同じ色分け。
- 引用は左に 2px の `border-input` の線、文字は `text-muted-foreground`。
- 表は `text-sm`、見出し行は `text-muted-foreground`、行の下に 1px の線。横にはみ出す表は横スクロールにする。
