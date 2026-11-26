<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Sidebar from './Sidebar.svelte'
  import type { SidebarAgent } from '../model/sidebar.js'

  /** The mock "now" the rows write their times against. */
  const now = new Date(2026, 10, 25, 9, 30)
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString()

  const main: SidebarAgent = {
    agentId: '00000000-0000-4000-8000-000000000001',
    slug: 'assistant',
    kind: 'working',
    status: 'running',
    avatar: { color: 'ink', pose: 'work' },
    latest: 'research と調査中',
    latestAt: ago(1),
    unread: 0,
  }

  const agents: SidebarAgent[] = [
    {
      agentId: '7f3a9c21-4d1e-4b8a-9c3f-2e6d8a1b5c07',
      slug: 'research',
      kind: 'working',
      status: 'live',
      avatar: { color: 'violet', pose: 'live' },
      latest: '論文3件の要約を返しました',
      latestAt: ago(8),
      unread: 2,
    },
    {
      agentId: 'a1',
      slug: 'scheduler',
      kind: 'working',
      status: 'queued',
      avatar: { color: 'teal', pose: 'sleep' },
      latest: '次は 03:00 に起きます',
      latestAt: ago(25),
      unread: 0,
    },
    {
      agentId: 'a2',
      slug: 'mailer',
      kind: 'working',
      status: 'error',
      avatar: { color: 'red', pose: 'worried' },
      latest: '認証情報が見つかりません',
      latestAt: ago(65),
      unread: 0,
    },
    {
      agentId: 'a3',
      slug: 'clipper',
      kind: 'working',
      status: 'live',
      avatar: { color: 'orange', pose: 'idle' },
      latest: '記事を5件保存しました',
      latestAt: new Date(2026, 10, 24, 20, 0).toISOString(),
      unread: 0,
    },
    {
      agentId: 'a4',
      slug: 'writer',
      kind: 'working',
      status: 'paused',
      avatar: { color: 'pink', pose: 'paused' },
      latest: '一時停止中',
      latestAt: new Date(2026, 10, 22, 12, 0).toISOString(),
      unread: 0,
    },
  ]

  const system: SidebarAgent[] = [
    {
      agentId: 's1',
      slug: 'system:memory',
      kind: 'dedicated',
      status: 'running',
      avatar: { color: 'system', pose: 'work' },
      latest: '記憶の抽出キューを処理中',
      latestAt: ago(3),
      unread: 12,
    },
  ]

  const { Story } = defineMeta({
    title: 'Kodama/Sidebar',
    component: Sidebar,
    tags: ['autodocs'],
    args: {
      main,
      agents,
      system,
      currentSlug: 'assistant',
      account: { name: 'hayatosc' },
      now,
    },
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'The agent list in the left pane, 280px wide. The main agent sits in the slot at the top with a 56px avatar, its state, and what it is doing now. The other agents follow with a 36px avatar, the latest event, and at the right their unread count or how long ago it was; pinned agents come first, then running ones, then the most recent. Dedicated agents sit under 「システム」 with gray avatars and monospaced names. The rows are buttons that choose an agent; the one on screen is marked as current. Search and create are at the top, the account at the bottom. Source: `design/components/Sidebar`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let current = $state('assistant')
</script>

<Story name="Default" asChild>
  <div class="h-[760px]">
    <Sidebar
      {main}
      {agents}
      {system}
      currentSlug={current}
      account={{ name: 'hayatosc' }}
      onselect={(slug) => (current = slug)}
      {now}
    />
  </div>
</Story>
