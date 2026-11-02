# Composer

画面下に浮かぶピル型の入力欄で、Enter で送信、エージェントの実行中は Tab で送信をキューに入れる。

- **使う側が渡すもの:** 宛先のエージェント名（「assistantにメッセージ」）、今の run の状態、キュー（送る予定のメッセージの配列）、`onsend(text)`、`onqueue(text)`、`onremove(index)`、`oncancel()`。
- 形は `h-12 rounded-full border bg-background shadow-lg px-2`。左に添付の丸ボタン、入力は `text-base`、右端に黒い丸ボタン。プレースホルダーは「〈名前〉にメッセージ」だけで、キー操作の説明は入れない。
- **待機中:** Enter で送信。右端は送信（`arrow-up`）。入力が空なら disabled。
- **シート:** 入力欄の上に、縁がつながったカード（`bg-card border border-b-0 rounded-t-xl`）を出す。次のどちらかのときだけ開く。
  - 実行中に入力している：見出しに「`Tab` でキューに追加」（`text-xs text-muted-foreground`）。Enter の案内は出さない。
  - キューがある：見出しは「キュー n」と、右に「実行が終わったら順に送ります」（入力中はここが「`Tab` でキューに追加」に替わる）。各行は番号・本文（1 行で省略）・削除ボタン。実行が終わると上から順に送り、シートから消える。
- 実行中に入力しているとき、右端は送信ボタン。Enter は今の run に割り込んで送る（steering）。Tab は送らずにキューへ入れる（followUp）。入力が空なら右端は停止（塗りの `square`）。
- **操作:** Enter で送信、Tab でキュー（実行中のみ）、シートの × で取り消し、停止で run を止める（止まるとキューの先頭から送る）。
- **スマートフォン（`mobile`）:** Tab キーがないので、シートの見出しに「キューに追加」ボタン（`h-7 rounded-full border border-input text-sm font-semibold`）を出す。押すとキューに入る。
- キー表示は Kbd。
- Shift+Enter で改行（複数行になったら高さを伸ばし、角丸を `rounded-3xl` に落とす）。
- 会話の列と同じ最大 720px で中央寄せ。
