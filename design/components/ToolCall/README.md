# ToolCall

An accordion that folds an agent's tool execution into one line. Opening it shows the arguments and result.

- **What the caller passes:** the tool name, a one-line summary (count, query, peer agent name), the duration, the state (running / done / error), the arguments (JSON), the result (text or JSON), and the result size.
- **Closed row:** `chevron-right` · name (`font-semibold text-foreground`) · summary (`text-muted-foreground`) · duration at the right (`font-mono text-xs`). The whole row is the toggle (`aria-expanded`). Opening rotates the chevron 90° (150ms).
- **Open content:** a `border rounded-lg bg-card` box.
  - Top section 「引数」 (Arguments): a small heading (`text-xs text-muted-foreground`) and 「コピー」 (Copy) at the right. JSON is `font-mono text-sm`, colored keys = `live`, strings = `running`, numbers = `destructive`, comments = `muted-foreground`.
  - Bottom section 「結果 · n 件 / 2.4 KB」 (Result · n items / 2.4 KB): a `bg-muted` bar. The body is `text-muted-foreground`.
  - When the result exceeds 5 lines, clip it at 104px, fade the bottom, and show 「すべて表示」 (Show all) (a small ghost button). Pressing it shows the full text.
- **Running:** a running dot instead of the chevron. The lower section says 「返事を待っています · 12s」 (Waiting for a reply · 12s) with a 2px indeterminate progress bar across the bottom of the box (`muted-foreground`; do not use the agent's color or status colors). The duration counts up.
- **Failure:** the name and time turn `text-destructive`. The lower section uses `bg-destructive-soft` with 「エラー」 (Error) and the tool's error as-is on one line (for example, `403 Forbidden`). Do not add explanatory text.
- Closed by default. Failed calls may start open.
- **Actions:** click the row or press Enter / Space to toggle. 「すべて表示」 (Show all) shows the full text; pressing again says 「折りたたむ」 (Collapse). Pressing 「コピー」 (Copy) changes it to 「コピーしました」 (Copied) for 1.4 seconds.
- The implementation is bits-ui's Collapsible. Update state and results on `tool_execution_start` / `_update` / `_end`.
