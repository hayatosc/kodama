<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import type { ActivityItem } from '#entities/activity/index.js'
  import type { ComboboxOption } from '#shared/ui/combobox/index.js'
  import ProfilePanel from './ProfilePanel.svelte'
  import type { AgentTool, MemoryItem, ProfileAgent, Routine } from '../model/profile.js'

  /** The mock "now" the activity is written against. */
  const now = new Date(2026, 10, 25, 9, 30)
  const at = (month: number, day: number, hour: number, minute: number) =>
    new Date(2026, month - 1, day, hour, minute).toISOString()

  const agent: ProfileAgent = {
    slug: 'assistant',
    status: 'running',
    avatar: { color: 'ink', pose: 'work' },
  }
  const routines: Routine[] = [{ id: 'morning', name: '毎朝のまとめ', schedule: '09:00 毎日' }]
  const providers: ComboboxOption[] = [
    'Anthropic',
    'OpenAI',
    'Google',
    'xAI',
    'Mistral',
    'DeepSeek',
    'Groq',
    'OpenRouter',
    'Cloudflare Workers AI',
  ].map((value) => ({ value }))
  const models: ComboboxOption[] = [
    ...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((value) => ({
      value,
      group: '最新',
    })),
    ...['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'].map((value) => ({
      value,
      group: '以前のモデル',
    })),
  ]
  const activity: ActivityItem[] = [
    { id: '1', at: at(11, 25, 9, 0), kind: 'cron', subject: 'まとめを作成中', active: true },
    { id: '2', at: at(11, 25, 8, 12), kind: 'peer', subject: 'research', detail: 'から返信' },
    { id: '3', at: at(11, 25, 3, 0), kind: 'alarm', subject: 'アラームで再開' },
    { id: '4', at: at(11, 25, 2, 41), kind: 'memory', subject: '記憶を抽出', detail: '· 2件' },
    { id: '5', at: at(11, 25, 2, 40), kind: 'error', subject: 'web_fetch 失敗' },
  ]
  const memories: MemoryItem[] = [
    {
      id: 'm1',
      kind: 'fact',
      text: '発表は 11/7（木）、持ち時間は 20 分。',
      source: 'research',
      at: at(10, 30, 12, 0),
    },
    {
      id: 'm2',
      kind: 'preference',
      text: '要約は 3 行以内、出典の URL を必ず付ける。',
      source: 'あなた',
      at: at(10, 28, 12, 0),
    },
    {
      id: 'm3',
      kind: 'procedure',
      text: '朝のまとめは 9:00 に送る。週末は送らない。',
      source: 'scheduler',
      at: at(10, 21, 12, 0),
    },
  ]
  const tools: AgentTool[] = [
    { name: 'web_search', description: 'Web を検索する', enabled: true },
    { name: 'web_fetch', description: 'ページや PDF を読む', enabled: true },
    { name: 'contact_agent', description: '他のエージェントに依頼する', enabled: true },
    { name: 'remember', description: '覚えておくことを保存する', enabled: false },
    {
      name: 'history_search',
      description: '過去の会話を探す（システムが管理）',
      enabled: true,
      locked: true,
    },
  ]

  const { Story } = defineMeta({
    title: 'Kodama/ProfilePanel',
    component: ProfilePanel,
    tags: ['autodocs'],
    args: {
      agent,
      routines,
      nextAlarm: '03:00',
      provider: 'Anthropic',
      providers,
      model: 'claude-sonnet-5-5',
      models,
      activity,
      memories,
      tools,
      tab: 'details',
      now,
    },
    argTypes: {
      tab: { control: 'inline-radio', options: ['details', 'memory', 'tools'] },
    },
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'An agent’s profile in the right pane, 320px wide: a 72px avatar with its name and status badge, then three tabs. **詳細** holds its routines and next alarm, its provider and model (searchable selects without an outline), and a compact activity feed. **記憶** holds a search and the remembered items, each with its kind (事実, 好み, 手順), its source and date; choosing one opens a menu to edit or delete it. **ツール** lists each tool with a switch; tools the system manages are shown but cannot be turned off. Source: `design/components/ProfilePanel`.',
        },
      },
    },
  })
</script>

{#snippet template(args: Parameters<typeof ProfilePanel>[1])}
  <div class="flex h-205 justify-end">
    <ProfilePanel {...args} tools={args.tools?.map((tool) => ({ ...tool }))} />
  </div>
{/snippet}

<Story name="Default" {template} />

<Story
  name="Memory"
  args={{ tab: 'memory' }}
  {template}
  parameters={{
    docs: {
      description: {
        story: 'The 記憶 tab: typing in the search narrows the list by text or source.',
      },
    },
  }}
/>

<Story
  name="Tools"
  args={{ tab: 'tools' }}
  {template}
  parameters={{
    docs: {
      description: {
        story:
          'The ツール tab: history_search is managed by the system, so its switch is disabled.',
      },
    },
  }}
/>
