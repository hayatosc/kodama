<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ActivityFeed from './ActivityFeed.svelte'
  import type { ActivityItem } from '../model/activity.js'

  /** The mock "now" every story writes its times against. */
  const now = new Date(2026, 10, 25, 9, 30)
  const at = (day: number, hour: number, minute: number) =>
    new Date(2026, 10, day, hour, minute).toISOString()

  const items: ActivityItem[] = [
    {
      id: '1',
      at: at(25, 9, 0),
      kind: 'cron',
      subject: '朝のまとめを作成中',
      detail: '· cron',
      active: true,
    },
    { id: '2', at: at(25, 8, 12), kind: 'peer', subject: 'research', detail: 'から返信 · 論文3件' },
    {
      id: '3',
      at: at(25, 3, 0),
      kind: 'alarm',
      subject: 'アラームで再開',
      detail: '· 中断した run を復旧',
    },
    {
      id: '4',
      at: at(25, 2, 41),
      kind: 'memory',
      subject: '記憶を抽出',
      detail: '· 2件追加、1件更新',
    },
    {
      id: '5',
      at: at(25, 2, 40),
      kind: 'error',
      subject: 'web_fetch 失敗',
      detail: '· 403 Forbidden',
    },
    {
      id: '6',
      at: at(24, 18, 5),
      kind: 'config',
      subject: '設定 v12 を適用',
      detail: '· v11 から',
    },
    { id: '7', at: at(23, 22, 0), kind: 'run', subject: 'run を完了', detail: '· 12 分' },
  ]

  const { Story } = defineMeta({
    title: 'Kodama/ActivityFeed',
    component: ActivityFeed,
    tags: ['autodocs'],
    args: { items, now, compact: false },
    argTypes: { compact: { control: 'boolean' } },
    parameters: {
      docs: {
        description: {
          component:
            'What agents did while nobody was watching, newest first: alarms, cron, exchanges with other agents, memory extraction, configuration, failures, and runs. Each row is a right-aligned time (09:00 today, 昨日, then 10/28), a node on a thin line (a 16px icon or a dot), and the subject in bold with muted detail. An event still in progress has the running dot; a failure has the destructive dot and subject. The compact form, with a 44px time column, goes in the right pane. Source: `design/components/ActivityFeed`.',
        },
      },
    },
  })
</script>

<Story name="Default" />

<Story
  name="Compact"
  args={{ compact: true, items: items.slice(0, 5) }}
  parameters={{
    docs: { description: { story: 'The right pane’s narrower form, as in the profile panel.' } },
  }}
/>
