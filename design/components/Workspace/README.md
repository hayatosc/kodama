# Workspace

Sidebar・会話・ProfilePanel を並べた画面全体で、ライトとダークの同じ画面を上下に並べた見本。

- **使う側が渡すもの:** ルートの `+layout.svelte` が Sidebar と ProfilePanel を持ち、`/`（メイン）と `agents/[slug]` のページが中央の会話を描く。
- 列は `grid-cols-[280px_1fr_320px]`。1280px 未満で右ペインを畳み、768px 未満では Sidebar もシートに畳む。
- 中央ペインには見出しバーを置かない。誰と話しているかは話者チップと右ペインが示し、会話の面を広く取る。
- Composer は中央ペインの下端に浮かせ、会話はその下までスクロールする。
