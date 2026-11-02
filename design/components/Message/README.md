# Message

会話の 1 発話で、ユーザーのピル・考え中ピル・エージェントの吹き出し・他エージェントからの伝言の 4 種類を形で区別する。

- **使う側が渡すもの:** `role`（user / assistant / thinking / peer）、本文（Markdown をレンダリング済みのもの）、peer なら送信元のアバター設定・`slug`・UUID・hop 数。
- user: 右寄せ、最大 70%、`bg-primary text-primary-foreground font-semibold`、1 行なら `rounded-full`、複数行なら `rounded-[20px]`。
- thinking: 作業中の一文、`bg-muted rounded-2xl px-3.5 py-1.5`。最新のものだけ末尾に 3 点のタイピング表示。
- assistant: `bg-muted rounded-2xl px-3.5 py-2.5`、最大 560px、本文 `text-base leading-7`（16/28）。見出しは太字の段落、箇条書きは `list-disc pl-5`。
- 会話は 1 体のエージェントとのものなので、エージェントの吹き出しに名前やアバターは付けない（誰の発言かは画面の文脈で分かる）。名前を出すのは他のエージェントからの伝言（peer）だけ。
- peer（`kodama.agent-message`）: `bg-background border rounded-2xl`、見出しに送信元の 18px アバター・名前・UUID 先頭 8 桁（`font-mono`）・hop 数。
- snapshot を受けたら発話のリストごと置き換える。
