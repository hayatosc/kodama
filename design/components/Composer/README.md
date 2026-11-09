# Composer

A pill-shaped input floating at the bottom of the screen. Enter sends; while the agent is running, Tab queues the send.

- **What the caller passes:** the target agent's name (「assistantにメッセージ」, "Message assistant"), the current run state, the queue (an array of messages to send), `onsend(text)`, `onqueue(text)`, `onremove(index)`, `oncancel()`.
- Shape: `h-12 rounded-full border bg-background shadow-lg px-2`. A round attachment button on the left, the input at `text-base`, and a black round button at the right end. The placeholder is only 「〈名前〉にメッセージ」 ("Message <name>"); do not include key hints.
- **Idle:** Enter sends. The right end is send (`arrow-up`). Disabled when the input is empty.
- **Sheet:** show a card whose edge joins the input (`bg-card border border-b-0 rounded-t-xl`) above it. Open it only in either of these cases:
  - Typing while a run is active: the header says 「`Tab` でキューに追加」 (Tab to add to queue) (`text-xs text-muted-foreground`). Do not show the Enter hint.
  - The queue is non-empty: the header says 「キュー n」 (Queue n), with 「実行が終わったら順に送ります」 (Sent in order when the run ends) on the right (while typing, this changes to 「`Tab` でキューに追加」). Each row has a number, the body (one line, truncated), and a remove button. The queue belongs to this screen and has not been sent to the agent yet. When the run ends, send from the top one at a time and remove each from the sheet.
- While typing during a run, the right end is the send button. Enter interrupts the current run and sends (`whenBusy: 'steer'`). Tab does not send; it adds to this screen's queue. When the input is empty, the right end is stop (filled `square`).
- **Actions:** Enter sends, Tab queues (only during a run), the sheet's × removes an item (not sent yet, so it just disappears), and stop stops the run (`cancel()` also withdraws accepted input; once stopped, send from the front of the screen's queue).
- **Phone (`mobile`):** there is no Tab key, so the sheet header shows an 「キューに追加」 (Add to queue) button (`h-7 rounded-full border border-input text-sm font-semibold`). Pressing it adds to the queue.
- Key hints use Kbd.
- Shift+Enter inserts a newline (grow the height for multiple lines and reduce the radius to `rounded-3xl`).
- Centered with the conversation column's 720px maximum.
