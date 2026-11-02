# ActivityFeed

人が見ていない間にエージェントがしたことを、時刻付きの縦の年表で見せる。

- **使う側が渡すもの:** 出来事の配列（時刻、種類、太字にする主語、補足）。種類はアラーム、cron、他エージェントとのやり取り、記憶の抽出、設定の適用、失敗、run の開始・終了。
- 3 列: 右寄せの時刻（`font-mono text-xs text-muted-foreground`）、ノード（ドットか 16px のアイコン）、本文（主語は `font-semibold text-foreground`、補足は `text-muted-foreground`）。
- ノードを縦の 1px の `border` 線でつなぐ。進行中の出来事は running のドット、失敗は destructive のドットと主語。
- 新しい順に上から。今日は `09:00`、それより前は「昨日」「10/28」。
- 右ペインでは幅を詰め、時刻列を 44px にする。
