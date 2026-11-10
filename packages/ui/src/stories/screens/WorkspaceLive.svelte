<script lang="ts">
  import { AgentAvatar, type AgentPose, type AgentProp } from '../../lib/components/avatar/index.js'
  import Composer from '../../lib/components/conversation/Composer.svelte'
  import Message from '../../lib/components/conversation/Message.svelte'
  import ToolCall from '../../lib/components/conversation/ToolCall.svelte'
  import AgentSidebar from '../../lib/components/panel/AgentSidebar.svelte'
  import type { RunState, SidebarAgent } from '../../lib/components/types.js'
  import { Button } from '../../lib/components/ui/button/index.js'
  import { NOW, ago } from '../mock.js'

  /**
   * design/components/WorkspaceLive: buttons fire the events behind each motion so the birds can
   * be watched end to end. Every step mirrors the design preview's script.
   */
  const reduce =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  /** An agent in the list, as live state. */
  function agent(
    slug: string,
    color: SidebarAgent['avatar']['color'],
    pose: AgentPose,
    status: RunState,
    latest: string,
    minutes: number,
    kind: SidebarAgent['kind'] = 'working',
  ): SidebarAgent {
    return {
      agentId: `${slug}-live`,
      slug,
      kind,
      status,
      avatar: { color, pose },
      latest,
      latestAt: ago(minutes),
      unread: 0,
    }
  }

  let main = $state(agent('assistant', 'ink', 'idle', 'queued', '次の依頼を待っています', 0))
  let research = $state(agent('research', 'violet', 'idle', 'live', '論文の要約を返しました', 12))
  let scheduler = $state(agent('scheduler', 'teal', 'sleep', 'queued', '03:00 に起きる', 390))
  let writer = $state(agent('writer', 'pink', 'idle', 'done', '下書きを保存しました', 60 * 20))
  let memory = $state(
    agent('system:memory', 'system', 'idle', 'queued', '抽出を待っています', 30, 'dedicated'),
  )

  let user = $state('Durable Objects のアラーム、来週の発表用にまとめておいて')
  let pill = $state('何でも言ってね。')
  let tool = $state<{ running: boolean; startedAt: number } | undefined>()
  let reply = $state<string | undefined>()
  let writing = $state(false)
  let running = $state(false)
  let queue = $state<string[]>([])
  let draft = $state('')
  let peek = $state(false)
  let events = $state<{ id: number; name: string; note?: string }[]>([])
  let busy = $state(false)

  type FlyIcon = 'letter' | 'card' | 'lens'
  type Flight = {
    id: number
    icon: FlyIcon
    frames: Keyframe[]
    duration: number
    easing: string
    done: () => void
  }
  let flights = $state<Flight[]>([])
  let root = $state<HTMLElement>()
  let sequence = 0

  function set(
    target: SidebarAgent,
    pose: AgentPose,
    extra: { prop?: AgentProp | null; mark?: string } = {},
  ): void {
    target.avatar = { color: target.avatar.color, pose, prop: extra.prop, mark: extra.mark }
  }

  function sub(target: SidebarAgent, status: RunState, latest: string): void {
    target.status = status
    target.latest = latest
  }

  function log(name: string, note?: string): void {
    events = [...events, { id: ++sequence, name, note }].slice(-3)
  }

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, reduce ? Math.min(ms, 300) : ms))
  }

  /** The center of an agent's avatar, in the root's coordinates. */
  function center(slug: string): { x: number; y: number } {
    const avatar = root?.querySelector(`[data-agent="${slug}"] .avatar`)
    const box = root?.getBoundingClientRect()
    if (!avatar || !box) return { x: 0, y: 0 }
    const rect = avatar.getBoundingClientRect()
    return { x: rect.left - box.left + rect.width / 2, y: rect.top - box.top + rect.height / 2 }
  }

  function launch(
    icon: FlyIcon,
    frames: Keyframe[],
    duration: number,
    easing: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      const id = ++sequence
      const done = (): void => {
        flights = flights.filter((flight) => flight.id !== id)
        resolve()
      }
      flights = [...flights, { id, icon, frames, duration: reduce ? 1 : duration, easing, done }]
    })
  }

  /** A letter or a card flies from one avatar to another on an arc, like a small bird. */
  function fly(icon: FlyIcon, from: string, to: string): Promise<void> {
    const a = center(from)
    const b = center(to)
    const lift = Math.min(60, Math.abs(b.y - a.y) / 2 + 24)
    return launch(
      icon,
      [
        { transform: `translate(${a.x - 11}px, ${a.y - 11}px) scale(.6)` },
        {
          transform: `translate(${(a.x + b.x) / 2 + 40 - 11}px, ${Math.min(a.y, b.y) - lift - 11}px) scale(1.1) rotate(-12deg)`,
        },
        { transform: `translate(${b.x - 11}px, ${b.y - 11}px) scale(.6)` },
      ],
      900,
      'cubic-bezier(.4,0,.2,1)',
    )
  }

  /** The lens slips out of the bird's grip when a run is cancelled. */
  function drop(from: string): Promise<void> {
    const a = center(from)
    return launch(
      'lens',
      [
        { transform: `translate(${a.x + 6}px, ${a.y - 4}px)`, opacity: 1 },
        { transform: `translate(${a.x + 18}px, ${a.y + 40}px) rotate(70deg)`, opacity: 0 },
      ],
      600,
      'cubic-bezier(.5,0,.9,.6)',
    )
  }

  /** The alarm rings the scheduler's time. */
  function ring(slug: string): void {
    const meta = root?.querySelector(`[data-agent="${slug}"] [data-meta]`)
    if (!meta || reduce) return
    meta.animate(
      [
        { transform: 'rotate(0)' },
        { transform: 'rotate(14deg)' },
        { transform: 'rotate(-14deg)' },
        { transform: 'rotate(0)' },
      ],
      { duration: 120, iterations: 6 },
    )
  }

  async function typeInto(text: string, ms: number, write: (value: string) => void): Promise<void> {
    for (let index = 1; index <= text.length; index++) {
      write(text.slice(0, index))
      if (!reduce) await new Promise((resolve) => setTimeout(resolve, ms))
    }
  }

  const actions = {
    async type(): Promise<void> {
      log('入力中', 'ユーザーがタイプしている')
      running = true
      peek = true
      set(main, 'listen')
      await typeInto('アラームの再試行についても書いて', 70, (value) => (draft = value))
      await wait(900)
      queue = [...queue, draft]
      draft = ''
      peek = false
      set(main, 'happy')
      log('Tab', 'キューに追加 · 実行が終わったら送る')
      await wait(1600)
      user = queue[0] ?? user
      queue = queue.slice(1)
      running = false
      log('send', 'キューから送信')
      set(main, 'idle')
    },
    async tool(): Promise<void> {
      log('tool_execution_start', 'web_search')
      tool = { running: true, startedAt: Date.now() }
      set(main, 'work', { prop: 'lens' })
      sub(main, 'running', 'web_search を実行中')
      pill = 'web_search で調べてる…'
      await wait(2600)
      tool = { running: false, startedAt: tool.startedAt }
      log('tool_execution_end', '5 件')
      set(main, 'happy')
      sub(main, 'queued', '次の依頼を待っています')
      pill = '5 件見つかった。'
      await wait(900)
      set(main, 'idle')
    },
    async reply(): Promise<void> {
      reply = ''
      writing = true
      log('message_update', '生成中')
      set(main, 'write')
      sub(main, 'running', '返答を書いている')
      pill = 'まとめを書いてる。'
      await typeInto(
        'アラームは 1 オブジェクトに 1 つ。失敗すると再実行されるから、Kodama は中断した run の復旧にも使っている。',
        45,
        (value) => (reply = value),
      )
      writing = false
      log('submission', 'done')
      set(main, 'happy')
      sub(main, 'queued', '次の依頼を待っています')
      pill = '書けた。'
      await wait(900)
      set(main, 'idle')
    },
    async unanswered(): Promise<void> {
      log('submission', 'unanswered')
      set(main, 'tilt', { mark: '?' })
      sub(main, 'queued', '答えられなかった')
      pill = 'うまく答えられなかった。'
      await wait(2000)
      set(main, 'idle')
      sub(main, 'queued', '次の依頼を待っています')
    },
    async cancel(): Promise<void> {
      set(main, 'work', { prop: 'lens' })
      sub(main, 'running', 'web_search を実行中')
      pill = 'web_search で調べてる…'
      await wait(1100)
      log('cancel', 'ユーザーが止めた')
      set(main, 'surprised', { mark: '!' })
      void drop('assistant')
      sub(main, 'queued', '止めました')
      pill = '止めた。'
      await wait(1300)
      set(main, 'idle')
      sub(main, 'queued', '次の依頼を待っています')
    },
    async contact(): Promise<void> {
      log('contact_agent', '→ research')
      set(main, 'idle', { prop: 'letter' })
      pill = 'research に頼んでくる。'
      await wait(700)
      set(main, 'idle')
      sub(main, 'running', 'research の返事待ち')
      await fly('letter', 'assistant', 'research')
      set(research, 'surprised')
      log('kodama.agent-message', 'assistant から · hop 1')
      await wait(450)
      set(research, 'write')
      sub(research, 'running', 'assistant の依頼を調査中')
      await wait(2400)
      set(research, 'happy')
      sub(research, 'live', '返信しました')
      await fly('letter', 'research', 'assistant')
      log('kodama.agent-message', 'research から返信')
      set(main, 'surprised')
      await wait(400)
      set(main, 'happy')
      sub(main, 'queued', '次の依頼を待っています')
      pill = 'research から返事が来た。'
      await wait(800)
      set(main, 'idle')
      set(research, 'idle')
    },
    async alarm(): Promise<void> {
      log('alarm', '03:00')
      ring('scheduler')
      sub(scheduler, 'queued', '03:00 起床')
      await wait(700)
      set(scheduler, 'stretch')
      await wait(1000)
      set(scheduler, 'write')
      sub(scheduler, 'running', '朝のまとめを作成中')
      await wait(2200)
      set(scheduler, 'happy')
      sub(scheduler, 'done', 'まとめを送りました')
      log('run_end', 'scheduler')
      await wait(1000)
      set(scheduler, 'sleep')
      sub(scheduler, 'queued', '明日 03:00 に起きる')
    },
    async memory(): Promise<void> {
      log('memory extraction', '2 件')
      sub(main, 'queued', '覚えたことを渡している')
      await wait(600)
      const first = fly('card', 'assistant', 'system:memory')
      await wait(250)
      await Promise.all([first, fly('card', 'assistant', 'system:memory')])
      sub(main, 'queued', '次の依頼を待っています')
      set(memory, 'write')
      sub(memory, 'running', '2 件を整理中')
      await wait(2000)
      set(memory, 'happy')
      sub(memory, 'done', '2 件を保存しました')
      await wait(900)
      set(memory, 'idle')
    },
    async pause(): Promise<void> {
      if (writer.avatar.pose !== 'paused') {
        log('lifecycle', 'writer → paused')
        set(writer, 'paused')
        sub(writer, 'paused', '一時停止中')
        return
      }
      log('lifecycle', 'writer → active')
      set(writer, 'stretch')
      sub(writer, 'live', '再開しました')
      await wait(1000)
      set(writer, 'idle')
    },
  }

  type Action = keyof typeof actions

  async function run(steps: Action[]): Promise<void> {
    if (busy) return
    busy = true
    try {
      for (const step of steps) {
        await actions[step]()
        if (steps.length > 1) await wait(500)
      }
    } finally {
      busy = false
    }
  }

  const groups: { label: string; buttons: { action: Action; label: string }[] }[] = [
    {
      label: '入力',
      buttons: [
        { action: 'type', label: '入力する' },
        { action: 'cancel', label: '止める' },
      ],
    },
    {
      label: '作業',
      buttons: [
        { action: 'tool', label: 'ツールを使う' },
        { action: 'reply', label: '返答を書く' },
        { action: 'unanswered', label: '答えられない' },
      ],
    },
    { label: 'ほかのエージェント', buttons: [{ action: 'contact', label: '依頼を送る' }] },
    {
      label: '裏側',
      buttons: [
        { action: 'alarm', label: 'アラーム' },
        { action: 'memory', label: '記憶を抽出' },
        { action: 'pause', label: '一時停止' },
      ],
    },
  ]

  /** Runs one flight's frames, then removes it. */
  function animate(flight: Flight) {
    return (element: HTMLElement) => {
      const animation = element.animate(flight.frames, {
        duration: flight.duration,
        easing: flight.easing,
        fill: 'forwards',
      })
      void animation.finished.then(flight.done, flight.done)
    }
  }
</script>

{#snippet flyIcon(icon: FlyIcon)}
  {#if icon === 'letter'}
    <svg viewBox="-1 -1 14 10.4" aria-hidden="true">
      <rect width="12" height="8.4" rx="1.6" class="paper" />
      <path d="M1 1.2l5 3.4 5-3.4" class="fold" />
    </svg>
  {:else if icon === 'card'}
    <svg viewBox="-1 -1 11 14" aria-hidden="true">
      <path d="M0 0h9v12l-4.5-3L0 12z" class="paper" />
      <path d="M2 3h5M2 5.5h3" class="fold" />
    </svg>
  {:else}
    <svg viewBox="-1 -1 14 14" aria-hidden="true">
      <circle cx="5" cy="5" r="4.2" class="glass" />
      <path d="M8 8l3.5 3.5" class="handle" />
    </svg>
  {/if}
{/snippet}

<div bind:this={root} class="relative flex h-[680px] flex-col overflow-hidden bg-background">
  <div class="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3">
    {#each groups as group, index (group.label)}
      {#if index > 0}<span aria-hidden="true" class="mx-1 h-5 w-px bg-border"></span>{/if}
      <span class="mr-0.5 text-[11px] text-muted-foreground">{group.label}</span>
      {#each group.buttons as button (button.action)}
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onclick={() => void run([button.action])}>{button.label}</Button
        >
      {/each}
    {/each}
    <Button
      size="sm"
      class="ml-auto"
      disabled={busy}
      onclick={() => void run(['type', 'tool', 'contact', 'reply', 'memory', 'alarm'])}
      >▶ 通しで見る</Button
    >
  </div>
  <div
    class="flex min-h-8 items-center gap-3.5 overflow-hidden border-b border-border bg-muted px-4 font-mono text-xs whitespace-nowrap text-muted-foreground"
    aria-live="polite"
    aria-label="イベント"
  >
    {#each events as event, index (event.id)}
      <span class="event">
        {#if index > 0}<span aria-hidden="true" class="mr-3.5">→</span>{/if}<b
          class="font-semibold text-foreground">{event.name}</b
        >{event.note ? `　${event.note}` : ''}
      </span>
    {:else}
      <span>ボタンを押すと、対応するイベントがここに流れます</span>
    {/each}
  </div>
  <div class="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]">
    <AgentSidebar
      {main}
      agents={[research, scheduler, writer]}
      system={[memory]}
      currentSlug="assistant"
      user={{ name: 'hayatosc' }}
      now={NOW}
    />
    <div class="flex min-w-0 flex-col px-8 py-5">
      <h2 class="sr-only">会話</h2>
      <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto pt-6">
        <Message role="user">{user}</Message>
        <div class="flex flex-col gap-2">
          <Message role="thinking" typing={busy}>
            <span class="-ml-1.5 mr-1 inline-flex align-middle">
              <AgentAvatar
                color="ink"
                pose={main.avatar.pose}
                prop={main.avatar.prop}
                mark={main.avatar.mark}
                size={20}
              />
            </span>{pill}
          </Message>
          {#if tool}
            <ToolCall
              name="web_search"
              summary={tool.running ? 'Durable Objects alarm retry' : '5 件'}
              state={tool.running ? 'running' : 'done'}
              startedAt={tool.startedAt}
              durationMs={tool.running ? undefined : 2600}
              args={{ query: 'Durable Objects alarm retry', limit: 5 }}
              pendingLabel="結果を待っています"
              resultSize="5 件"
              result={tool.running
                ? undefined
                : '1. Alarms · Cloudflare Durable Objects docs\n2. Durable Objects: alarm retries and backoff\n3. Building reliable schedulers with alarms\n4. Alarm API reference\n5. Changelog: alarm retry limits'}
            />
          {/if}
          {#if reply !== undefined}
            <Message role="assistant" streaming={writing}><p>{reply}</p></Message>
          {/if}
        </div>
      </div>
      <div class="relative mx-auto w-full max-w-[640px]">
        <span class={['peek', peek && 'up']} aria-hidden="true">
          <AgentAvatar color="ink" pose="listen" size={36} />
        </span>
        <Composer
          agentName="assistant"
          {running}
          {queue}
          bind:value={draft}
          onsend={(text) => (user = text)}
          onqueue={(text) => (queue = [...queue, text])}
          onremove={(index) => (queue = queue.filter((_, i) => i !== index))}
          oncancel={() => (running = false)}
        />
      </div>
    </div>
  </div>
  {#each flights as flight (flight.id)}
    <div class="fly" {@attach animate(flight)}>{@render flyIcon(flight.icon)}</div>
  {/each}
</div>

<style>
  .event {
    animation: log-in 0.3s ease;
  }
  @keyframes log-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .peek {
    position: absolute;
    right: 76px;
    bottom: 8px;
    /* Above the composer's sheet, below the input itself, as if peering over its edge. */
    z-index: 5;
    opacity: 0;
    transform: translateY(6px);
    transition:
      transform 0.4s cubic-bezier(0.3, 1.5, 0.5, 1),
      opacity 0.15s;
  }
  .peek.up {
    opacity: 1;
    transform: translateY(-34px);
  }
  .fly {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 5;
    width: 22px;
    height: 22px;
    pointer-events: none;
  }
  .fly svg {
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  /* The props keep the avatar's light colors in both themes. */
  .paper {
    fill: #ffffff;
    stroke: #767676;
    stroke-width: 0.8;
  }
  .fold {
    fill: none;
    stroke: #636363;
    stroke-width: 0.9;
    stroke-linecap: round;
  }
  .glass {
    fill: #fffcf6;
    fill-opacity: 0.25;
    stroke: #0a0a0a;
    stroke-width: 1.4;
  }
  .handle {
    stroke: #0a0a0a;
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  @media (prefers-reduced-motion: reduce) {
    .event {
      animation: none;
    }
    .peek {
      transition: none;
    }
  }
</style>
