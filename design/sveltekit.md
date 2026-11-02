# SvelteKit での実装

## スタック

- SvelteKit 3（Svelte 5 の runes）+ `@sveltejs/adapter-cloudflare`。UI Worker は D1 を束ねず、`AgentService` にだけサービスバインディングで話す。
- データの読み書きは **Async Svelte と Remote Functions** で行う。`load` 関数・`+page.server.ts`・form actions・自前の `+server.ts` の API は作らない。コンポーネントの中で `await` し、待ち時間は `<svelte:boundary>` の `pending` で見せる。
- 設定は `vite.config.ts` に置く（SvelteKit 3 では `svelte.config.js` を使わない）。ライブラリの別名は `$lib` ではなく `#lib`（標準の subpath imports）。
- Tailwind CSS v4（`@tailwindcss/vite`）。設定ファイルは作らず、`app.css` の `@theme inline` でトークンをユーティリティにつなぐ。
- shadcn-svelte（bits-ui ベース）を土台にし、Button・Badge・Dialog・DropdownMenu・Tooltip・Collapsible・ScrollArea はそれを使う。AgentAvatar・Sidebar・Message・ToolCall・Composer・ProfilePanel・ActivityFeed は Kodama 固有として自作する。
- アイコンは `@lucide/svelte`。
- 書体は npm の `gen-interface-jp`（`import 'gen-interface-jp/400.css'`、`600.css`、`display-600.css` の3つだけ読み込む。unicode-range の分割 WOFF2 なので必要な文字だけ届く）。等幅は Geist Mono（400 と 600）。

## トークンのつなぎ方

`tokens.css`（このシステムが生成する CSS 変数）を読み込み、Tailwind に名前を渡す。

```css
/* src/app.css */
@import 'tailwindcss';
@import './lib/styles/tokens.css';

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-sidebar: var(--sidebar);
  --color-card: var(--card);
  --color-popover: var(--popover);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-soft: var(--destructive-soft);
  --color-live: var(--live);
  --color-live-soft: var(--live-soft);
  --color-running: var(--running);
  --color-running-soft: var(--running-soft);
  --color-agent-orange: var(--agent-orange);
  --color-agent-yellow: var(--agent-yellow);
  --color-agent-green: var(--agent-green);
  --color-agent-teal: var(--agent-teal);
  --color-agent-sky: var(--agent-sky);
  --color-agent-blue: var(--agent-blue);
  --color-agent-violet: var(--agent-violet);
  --color-agent-plum: var(--agent-plum);
  --color-agent-pink: var(--agent-pink);
  --color-agent-red: var(--agent-red);
  --color-agent-brown: var(--agent-brown);
  --color-agent-ink: var(--agent-ink);
  --color-agent-system: var(--agent-system);
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground font-sans text-base antialiased;
  }
}
```

`--font-sans` と `--font-mono` は tokens.css がレイヤー外で宣言するので、Tailwind の既定より優先される。角丸・余白・文字サイズは Tailwind の既定スケール（`rounded-lg` = 8px、`p-4` = 16px、`text-base` = 16/24、`text-sm` = 14/20）がそのままトークンと一致するので上書きしない。`<html data-theme="light">` を既定にし（OS 設定に合わせるなら `prefers-color-scheme` で初期値を決め）、切り替えは `data-theme` を書き換える。

## 有効にする

Remote Functions はまだ experimental で、Async Svelte と一緒にフラグで有効にする。

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: { experimental: { async: true } },
      experimental: { remoteFunctions: true },
    }),
  ],
})
```

## ルートの形

```text
src/routes/
  +layout.svelte                 3ペインの殻（Sidebar / children / 右ペイン）。一覧は await listAgents()
  agents.remote.ts               一覧・作成・名前の変更
  agents/[slug]/+page.svelte     会話（Message, ToolCall, Composer）
  agents/[slug]/agent.remote.ts  snapshot・購読・送信・停止・設定
  agents/[slug]/settings/        設定バージョン、ロールバック
  settings/                      認証情報、モデル、メンバー
src/hooks.server.ts              ユーザー認証。locals にユーザーを置く
```

- `*.remote.ts` は `server` フォルダの中に置けない。ルートの隣に置き、ページから直接 import する。
- スキーマ（`AgentRef`、`SendInput`）は `*.remote.ts` から export できないので、`#lib/schemas.ts` に置く（valibot。Standard Schema なのでそのまま渡せる）。

## Remote Functions

すべての関数は `getRequestEvent()` で認証済みのユーザーを確かめてから `AgentService` を呼ぶ。エージェント ID の認可もここで行う（UI Worker が守る private RPC の境界）。

```ts
// src/routes/agents/[slug]/agent.remote.ts
import { command, form, getRequestEvent, query } from '$app/server'
import { error } from '@sveltejs/kit'
import type { ManagementActor } from '@kodama/agents/protocol'
import { AgentRef, SendInput } from '#lib/schemas'
import { readEvents } from '#lib/sse'

/** The service binding and the signed-in user as a management actor. */
function service() {
  const { locals, platform } = getRequestEvent()
  if (!locals.user || !platform) error(401)
  // hooks.server.ts puts the Cloudflare Access identity on locals.user.
  const actor: ManagementActor = { kind: 'user', externalId: locals.user.email }
  return { agents: platform.env.AGENT_SERVICE, actor }
}

/** The route slug as a working agent's UUID: conversation RPCs accept only UUIDs. */
async function agentId(slug: string): Promise<string> {
  const { agents, actor } = service()
  const agent = await agents.resolveAgent(actor, slug)
  if (agent.kind !== 'working') error(404)
  return agent.agentId
}

/** The whole conversation state; always replaced, never appended to. */
export const getSnapshot = query(AgentRef, async (slug) => {
  const { snapshot } = await service().agents.snapshot(await agentId(slug))
  return snapshot
})

/** subscribe() as a live query: its SSE bytes, parsed into a snapshot first, then run events. */
export const watchAgent = query.live(AgentRef, async function* (slug) {
  const stream = await service().agents.subscribe(await agentId(slug))
  for await (const event of readEvents(stream)) yield event
})

/** Enter steers the current run; Tab, or the queue button on phones, follows it up. */
export const sendMessage = form(SendInput, async ({ slug, content, whenBusy, requestId }) => {
  // sendMessage() only admits the message; watchAgent streams the run.
  await service().agents.sendMessage(await agentId(slug), { requestId, content, whenBusy })
  void getSnapshot(slug).refresh()
})

export const cancelRun = command(AgentRef, async (slug) => {
  await service().agents.cancel(await agentId(slug))
  void getSnapshot(slug).refresh()
})
```

- 会話の RPC（`snapshot` `subscribe` `sendMessage` `cancel`）はエージェントの UUID しか受け付けない。ルートの slug は、サインインしたユーザーを actor にした `resolveAgent` で UUID に引き直す。dedicated なエージェントは 404 にする。
- 送る値は `SendMessageRequest`（`requestId`、`content`、`whenBusy: 'steer' | 'followUp'`）。Enter は `steer`、Tab とスマートフォンのキューボタンは `followUp`。同じ送信をやり直すときは同じ `requestId` を使う。
- `subscribe()` は SSE のバイト列（`ReadableStream<Uint8Array>`）を返すので、`#lib/sse` の `readEvents` でイベントに分けてから流す。
- 読むのは `query`、Composer の送信は `form`（`<form {...sendMessage}>`、Enter・Tab は `sendMessage.enhance` の中で `whenBusy` を入れて `submit()`）、停止のようにフォームでない操作は `command`。
- 変更のあとは関係する query の `refresh()` を呼ぶ（single-flight mutation）。結果が同じ応答で返り、往復が 1 回で済む。
- 送信中は `sendMessage.pending`、入力欄の検証エラーは `sendMessage.fields.content.issues()`。
- 一覧の最後の出来事のように、行ごとに同じ問い合わせが並ぶものは `query.batch` でまとめる。

## ページでの使い方

```svelte
<!-- src/routes/agents/[slug]/+page.svelte -->
<script lang="ts">
  import { getSnapshot, watchAgent, sendMessage } from './agent.remote'
  import { applyEvent } from '#lib/transcript'

  let { params } = $props()
  let state = $derived(await getSnapshot(params.slug))

  $effect(() => {
    const live = watchAgent(params.slug)
    ;(async () => {
      for await (const event of live) state = applyEvent(state, event)
    })()
  })
</script>

<svelte:boundary>
  <Transcript {state} />
  <Composer agent={state.agent} running={state.running} form={sendMessage} />
  {#snippet pending()}<TranscriptSkeleton />{/snippet}
  {#snippet failed(error, reset)}<ErrorState {error} onretry={reset} />{/snippet}
</svelte:boundary>
```

- 初回表示は SSR で `await getSnapshot()` の値を描く。`watchAgent` は SSR では最初の値だけ返し、ブラウザで購読を続ける。
- 接続が切れたら `watchAgent(slug).connected` が false になる。見出しの状態を「再接続中」にし、`reconnect()` で戻す。
- 待ち時間の表示は、ページ全体ではなく `<svelte:boundary>` ごとに出す（一覧・会話・右ペインを別々に）。

## メインのエージェント

- メインは「最初に作られた working agent」（seed の `assistant`）とし、設定で別のエージェントに付け替えられるようにする。`agents.remote.ts` の `listAgents` が `main` と `others` に分けて返す。
- `/` はメインの会話に直接入る。他のエージェントは `/agents/[slug]`。

## ストリームの扱い

- `subscribe()` は最初に `snapshot` を送り、その後 `message_update` `tool_execution_*` `submission` `run_end` が続く。**snapshot はいつ来ても状態を丸ごと置き換える**（追記しない）。`applyEvent` は snapshot を受けたら state をそのまま差し替える。
- 再接続時はイベント再送がないので、新しい snapshot を待って置き換える。
- 送信は `accepted` → `snapshot` → run のイベント → `submission` で閉じる。切断しても入力は取り消されないので、同じ `requestId` で再送すれば受領を取り直せる。

## Markdown のストリーミング描画

エージェントの返答は、Vercel の [Streamdown](https://github.com/vercel/streamdown) を Svelte に移した `Streamdown.svelte`（`#lib/components/streamdown/`）で描く。届いた途中の Markdown をそのまま渡しても崩れずに描けるようにするのが目的。

```svelte
<Streamdown source={message.text} streaming={message.streaming} />
```

- **受け取るもの:** Markdown の全文（`source`）と、生成中かどうか（`streaming`）。`message_update` の差分は `applyEvent` が本文につなぎ、Streamdown には毎回全文を渡す。snapshot が来たら本文ごと差し替える。
- **閉じていない記法を補う:** 生成中は描く前に `remend` で、閉じていない `**` `_` `` ` `` リンク・コードフェンスを一時的に閉じる。`**強調` の途中で記号がむき出しになったり、コードブロックが本文を飲み込んだりしない。
- **ブロックに分けて描く:** 全文をトップレベルのブロック（段落、リスト、表、コードブロック）に分け、`{#each blocks as block (block.key)}` で描く。各ブロックは内容の文字列でメモ化するので、生成中に描き直すのは最後のブロックだけ。
- **安全に描く:** remark（`remark-gfm`、`remark-math`）→ rehype → `rehype-harden` の順に通し、リンクと画像は許可した接頭辞（`https://` など）だけ残す。モデルの出力を `{@html}` に流さず、hast のノードを Svelte の要素として描く。
- **部品の差し替え:** タグごとに Kodama の部品へ割り当てる（見た目は Prose）。コードブロックはコピーボタンつきの CodeBlock で、Shiki による色分けは言語ごとに遅延読み込みし、フェンスが閉じてから適用する（生成中は等幅の素の文字で、ちらつかせない）。数式は KaTeX、Mermaid は「図にする」ボタンで描く。どれも使われたときに初めて読み込む。
- **日本語:** `**強調**の` のように強調の直後に文字が続くと CommonMark では強調にならないので、Streamdown の `cjk` と同じく `remark-cjk-friendly` を入れる。
- **キャレット:** 生成中は最後のブロックの末尾に点滅するキャレットを置き、`streaming` が false になったら消す。`prefers-reduced-motion` では点滅させない。

## コンポーネントの対応

| このシステム    | Svelte                                                                    | 土台                                                                                                                        |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Button          | `#lib/components/ui/button`                                               | shadcn-svelte Button（variant を primary / secondary / ghost / destructive に）                                             |
| AgentAvatar     | `AgentAvatar.svelte`（鳥、眠っている間は巣箱）                            | 自作（インライン SVG。鳥と巣箱は bundle.js の `bird()` `house()` `avatar()`、動きは bundle.css の `kd-p-*` をそのまま移す） |
| StatusBadge     | `StatusBadge.svelte`                                                      | shadcn-svelte Badge                                                                                                         |
| Sidebar         | `AgentSidebar.svelte`                                                     | shadcn-svelte Sidebar                                                                                                       |
| Message         | `Message.svelte`（user / assistant / thinking / peer）                    | 自作                                                                                                                        |
| ToolCall        | `ToolCall.svelte`                                                         | bits-ui Collapsible                                                                                                         |
| Tabs            | `#lib/components/ui/tabs`                                                 | shadcn-svelte Tabs                                                                                                          |
| Select          | `#lib/components/ui/combobox`（検索つき）                                 | shadcn-svelte Combobox（bits-ui Combobox）                                                                                  |
| Switch          | `#lib/components/ui/switch`                                               | shadcn-svelte Switch                                                                                                        |
| SettingsList    | `SettingsList.svelte`                                                     | 自作                                                                                                                        |
| Prose           | `Streamdown.svelte`（途中の Markdown も崩さず描く。見た目は Prose）       | 自作（Streamdown の Svelte 版。remend、remark / rehype、rehype-harden、Shiki、KaTeX）                                       |
| Dialog          | `#lib/components/ui/alert-dialog`                                         | shadcn-svelte AlertDialog                                                                                                   |
| Kbd             | `Kbd.svelte`                                                              | 自作                                                                                                                        |
| Composer        | `Composer.svelte`（キューのシートつき。`mobile` で Tab の代わりにボタン） | 自作（Textarea）                                                                                                            |
| ProfilePanel    | `ProfilePanel.svelte`                                                     | shadcn-svelte Tabs + Select                                                                                                 |
| ActivityFeed    | `ActivityFeed.svelte`                                                     | 自作                                                                                                                        |
| Mobile のシート | `#lib/components/ui/drawer`                                               | shadcn-svelte Drawer（vaul-svelte）                                                                                         |
