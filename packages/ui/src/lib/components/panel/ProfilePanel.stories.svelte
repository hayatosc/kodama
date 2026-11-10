<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { NOW, activity, memories, models, providers, tools } from '../../../stories/mock.js'
  import ProfilePanel from './ProfilePanel.svelte'

  const agent = {
    slug: 'assistant',
    status: 'running',
    avatar: { color: 'ink', pose: 'write' },
  } as const

  const { Story } = defineMeta({
    title: 'Kodama/ProfilePanel',
    component: ProfilePanel,
    tags: ['autodocs'],
    args: {
      agent,
      routines: [{ name: '毎朝のまとめ', schedule: '09:00 毎日' }],
      nextAlarm: '03:00',
      provider: 'anthropic',
      providers,
      model: 'claude-sonnet-5-5',
      models,
      activity,
      memories,
      tools,
      tab: 'details',
      now: NOW,
    },
    argTypes: { tab: { control: 'inline-radio', options: ['details', 'memory', 'tools'] } },
    parameters: {
      layout: 'fullscreen',
      docs: {
        description: {
          component:
            'The agent’s profile in the right pane, 320px wide: its face, name, and state, then three tabs. 詳細 (Details) holds routines, provider and model, and a compact activity feed; 記憶 (Memory) a searchable list of what it remembers with where each came from; ツール (Tools) its tools with switches, system-managed ones disabled. Source: `design/components/ProfilePanel`.',
        },
      },
    },
  })
</script>

<Story name="Details" />

<Story name="Memory" args={{ tab: 'memory' }} />

<Story name="Tools" args={{ tab: 'tools' }} />
