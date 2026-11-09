# Implementing in SvelteKit

## Stack

- SvelteKit 3 (Svelte 5 runes) + `@sveltejs/adapter-cloudflare`. The UI Worker binds no D1 database and talks only to `AgentService` through a service binding.
- Read and write data with **Async Svelte and Remote Functions**. Do not create `load` functions, `+page.server.ts`, form actions, or your own `+server.ts` APIs. `await` inside components and show pending states with `<svelte:boundary>`'s `pending`.
- Put configuration in `vite.config.ts` (SvelteKit 3 does not use `svelte.config.js`). Alias libraries through `#lib`, not `$lib` (standard subpath imports).
- Tailwind CSS v4 (`@tailwindcss/vite`) with `kiso.css` as the reset instead of Tailwind Preflight. Do not create a configuration file; connect tokens to utilities with `@theme inline` in `app.css`.
- Build on shadcn-svelte (bits-ui) for Button, Badge, Dialog, DropdownMenu, Tooltip, Collapsible, and ScrollArea. Build AgentAvatar, Sidebar, Message, ToolCall, Composer, ProfilePanel, and ActivityFeed yourself as Kodama-specific components.
- Icons are `@lucide/svelte`.
- Load the typeface from the npm package `gen-interface-jp` (only three imports: `import 'gen-interface-jp/400.css'`, `600.css`, and `display-600.css`; the WOFF2 files are split by unicode-range, so only the needed characters arrive). Monospace is Geist Mono (400 and 600).

## Wiring the tokens

Load `kiso.css` as the reset, `tokens.css` (the CSS variables this system generates), and Tailwind's theme and utilities, then hand the names to Tailwind. Importing `tailwindcss` as a whole would also bring Preflight, which kiso replaces.

```css
/* src/app.css */
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import 'kiso.css' layer(base);
@import './lib/styles/tokens.css' layer(base);

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

`kiso.css` gives the UI Japanese-aware defaults (`text-autospace`, `line-break: strict`, `text-spacing-trim`) through zero-specificity `:where()` selectors. Importing it into the base layer keeps those defaults below utilities, and importing `tokens.css` after it lets the tokens override its root values. Its root `line-height: 1.5` matches `type-base` (16/24); conversation text still adds `leading-7`. kiso gives form controls a 1px border; the base layer resets it to 0 so controls opt into borders with utilities (the design's primary and ghost buttons are borderless). `tokens.css` declares `--font-sans` and `--font-mono` in the base layer, so they override Tailwind's theme defaults. Radius, spacing, and type sizes already match the tokens in Tailwind's default scale (`rounded-lg` = 8px, `p-4` = 16px, `text-base` = 16/24, `text-sm` = 14/20), so do not override them. Make `<html data-theme="light">` the default (derive the initial value from `prefers-color-scheme` if you want to follow the OS), and switch themes by rewriting `data-theme`.

## Enabling the flags

Remote Functions are still experimental and are enabled with a flag, along with Async Svelte.

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

## Route shape

```text
src/routes/
  +layout.svelte                 three-pane shell (Sidebar / children / right pane); the list awaits listAgents()
  agents.remote.ts               list, create, rename
  agents/[slug]/+page.svelte     conversation (Message, ToolCall, Composer)
  agents/[slug]/agent.remote.ts  snapshot, subscription, send, stop, settings
  agents/[slug]/settings/        configuration versions, rollback
  settings/                      credentials, models, members
src/hooks.server.ts              user authentication; puts the user on locals
```

- `*.remote.ts` cannot live in the `server` folder. Put it next to the route and import it directly from the page.
- Schemas (`AgentRef`, `SendInput`) cannot be exported from `*.remote.ts`, so put them in `#lib/schemas.ts` (valibot; it implements Standard Schema, so it can be passed as-is).

## Remote Functions

Every function checks the authenticated user with `getRequestEvent()` before calling `AgentService`. Agent ID authorization also happens here (the private RPC boundary the UI Worker protects).

```ts
// src/routes/agents/[slug]/agent.remote.ts
import { command, form, getRequestEvent, query } from '$app/server'
import { error } from '@sveltejs/kit'
import type { ManagementActor } from '@kodama/agents/protocol'
import { AgentRef, SendInput } from '#lib/schemas'
import { readEvents } from '#lib/sse'
import { applyEvent, type Conversation } from '#lib/transcript'

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

/**
 * subscribe() as a live query. message_update carries only changes, and a live query keeps just
 * the latest value a slow reader has not taken, so fold the events here and yield the whole
 * conversation: a skipped value then loses nothing.
 */
export const watchAgent = query.live(AgentRef, async function* (slug) {
  const stream = await service().agents.subscribe(await agentId(slug))
  let state: Conversation | undefined
  for await (const event of readEvents(stream)) {
    state = applyEvent(state, event)
    yield state
  }
})

/** Enter sends now (steering a running agent); queued drafts go through here when a run ends. */
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

- The conversation RPCs (`snapshot` `subscribe` `sendMessage` `cancel`) accept only an agent UUID. Resolve the route slug to a UUID through `resolveAgent` with the signed-in user as the actor. Dedicated agents return 404.
- The payload is `SendMessageRequest` (`requestId`, `content`, `whenBusy: 'steer' | 'followUp'`). Enter uses `steer` while a run is active and interrupts the current run. Tab and the phone's queue button do not send yet; they add to the page's queue. When the run ends, send the queue one message at a time from the front with `sendMessage` (there is no RPC to withdraw a single accepted message, so a message can only be cancelled before it is sent). Reuse the same `requestId` when retrying the same send.
- `subscribe()` returns SSE bytes (`ReadableStream<Uint8Array>`), so split them into events with `readEvents` from `#lib/sse`. `message_update` carries only changes (`changes`), and a live query keeps only the latest value when the reader falls behind, dropping intermediate ones. Therefore fold events into conversation state on the server (inside `watchAgent`) with `applyEvent` and stream the whole state. Dropped intermediate values never lose characters.
- Reads use `query`; Composer sends use `form` (`<form {...sendMessage}>`; Enter sets `whenBusy` inside `sendMessage.enhance` and calls `submit()`); operations that are not forms, such as stop, use `command`. `cancel()` stops the current run and also withdraws accepted input.
- After a mutation, call `refresh()` on the related queries (single-flight mutation). The result comes back in the same response, saving a round trip.
- While sending, use `sendMessage.pending`; for input validation errors, use `sendMessage.fields.content.issues()`.
- When the same query repeats per row, such as the latest event in a list, batch them with `query.batch`.

## Using them on a page

```svelte
<!-- src/routes/agents/[slug]/+page.svelte -->
<script lang="ts">
  import { watchAgent, sendMessage } from './agent.remote'

  let { params } = $props()
  // The latest whole conversation; a new slug starts a new live query and drops the old one.
  const live = $derived(watchAgent(params.slug))
  const state = $derived(await live)
</script>

<svelte:boundary>
  <Transcript {state} />
  <Composer agent={state.agent} running={state.running} form={sendMessage} />
  {#snippet pending()}<TranscriptSkeleton />{/snippet}
  {#snippet failed(error, reset)}<ErrorState {error} onretry={reset} />{/snippet}
</svelte:boundary>
```

- The first render is SSR. `watchAgent` returns only the first value (the state assembled from the snapshot) during SSR and keeps the subscription in the browser. Do not write `for await` or `$effect`. SvelteKit disconnects a live query the page no longer uses, which stops the server-side subscription.
- When the connection drops, `watchAgent(slug).connected` becomes false. Set the header state to "reconnecting" and restore it with `reconnect()`.
- Show pending states per `<svelte:boundary>` (list, conversation, right pane), not for the whole page.

## The main agent

- The main agent is "the first working agent created" (the seed's `assistant`), and settings can reassign the role to another agent. `listAgents` in `agents.remote.ts` returns `main` and `others` separately.
- `/` goes straight to the main agent's conversation. Other agents are at `/agents/[slug]`.

## Handling the stream

- `subscribe()` sends a `snapshot` first, then `message_update`, `tool_execution_*`, `submission`, and `run_end`. **A snapshot always replaces the whole state, whenever it arrives** (never append). `applyEvent` (used server-side inside `watchAgent`) swaps in the state as-is when it receives a snapshot, and connects `message_update` deltas to the message being generated.
- On reconnect, events are not replayed, so wait for a new snapshot and replace.
- A send closes with `accepted` → `snapshot` → run events → `submission`. A disconnect does not cancel the input, so resending with the same `requestId` regains the receipt.

## Streaming Markdown

Agent replies are rendered by `Streamdown.svelte` (`#lib/components/streamdown/`), a Svelte port of Vercel's [Streamdown](https://github.com/vercel/streamdown). The goal is to render partial Markdown without breaking it.

```svelte
<Streamdown source={message.text} streaming={message.streaming} />
```

- **What it receives:** the full Markdown (`source`) and whether it is streaming (`streaming`). `applyEvent` on the server connects `message_update` deltas to the body, and Streamdown always receives the full text. A snapshot replaces the body along with everything else.
- **Close unclosed syntax:** while streaming, `remend` temporarily closes unclosed `**`, `_`, backticks, links, and code fences before rendering. This keeps a half-typed `**bold` from showing bare symbols or a code block from swallowing the body.
- **Render by block:** split the text into top-level blocks (paragraphs, lists, tables, code blocks) and render with `{#each blocks as block (block.key)}`. Each block is memoized by its content string, so during streaming only the last block is redrawn.
- **Render safely:** pass through remark (`remark-gfm`, `remark-math`) → rehype → `rehype-harden`, keeping only links and images with allowed prefixes (such as `https://`). Never send model output into `{@html}`; render hast nodes as Svelte elements.
- **Replace elements:** map each tag to a Kodama component (the look is Prose). Code blocks use CodeBlock with a copy button; Shiki highlighting is loaded lazily per language and applied after the fence closes (while streaming, use plain monospace text so nothing flickers). Math uses KaTeX; Mermaid renders through a "render diagram" button. All of them load only when used.
- **Japanese:** CommonMark does not treat `**強調**の` as emphasis when a character follows the closing marker, so include `remark-cjk-friendly`, the same as Streamdown's `cjk`.
- **Caret:** while streaming, place a blinking caret at the end of the last block and remove it when `streaming` is false. Do not blink under `prefers-reduced-motion`.

## Component mapping

| This system  | Svelte                                                                               | Base                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Button       | `#lib/components/ui/button`                                                          | shadcn-svelte Button (variants primary / secondary / ghost / destructive)                                                               |
| AgentAvatar  | `AgentAvatar.svelte` (bird; a birdhouse while asleep)                                | Custom (inline SVG; bird and birdhouse from `bird()` `house()` `avatar()` in bundle.js; motion moved as-is from `kd-p-*` in bundle.css) |
| StatusBadge  | `StatusBadge.svelte`                                                                 | shadcn-svelte Badge                                                                                                                     |
| Sidebar      | `AgentSidebar.svelte`                                                                | shadcn-svelte Sidebar                                                                                                                   |
| Message      | `Message.svelte` (user / assistant / thinking / peer)                                | Custom                                                                                                                                  |
| ToolCall     | `ToolCall.svelte`                                                                    | bits-ui Collapsible                                                                                                                     |
| Tabs         | `#lib/components/ui/tabs`                                                            | shadcn-svelte Tabs                                                                                                                      |
| Select       | `#lib/components/ui/combobox` (with search)                                          | shadcn-svelte Combobox (bits-ui Combobox)                                                                                               |
| Switch       | `#lib/components/ui/switch`                                                          | shadcn-svelte Switch                                                                                                                    |
| SettingsList | `SettingsList.svelte`                                                                | Custom                                                                                                                                  |
| Prose        | `Streamdown.svelte` (renders partial Markdown without breaking it; looks like Prose) | Custom (Svelte port of Streamdown; remend, remark / rehype, rehype-harden, Shiki, KaTeX)                                                |
| Dialog       | `#lib/components/ui/alert-dialog`                                                    | shadcn-svelte AlertDialog                                                                                                               |
| Kbd          | `Kbd.svelte`                                                                         | Custom                                                                                                                                  |
| Composer     | `Composer.svelte` (with a queue sheet; `mobile` swaps Tab for a button)              | Custom (Textarea)                                                                                                                       |
| ProfilePanel | `ProfilePanel.svelte`                                                                | shadcn-svelte Tabs + Select                                                                                                             |
| ActivityFeed | `ActivityFeed.svelte`                                                                | Custom                                                                                                                                  |
| Mobile sheet | `#lib/components/ui/drawer`                                                          | shadcn-svelte Drawer (vaul-svelte)                                                                                                      |
