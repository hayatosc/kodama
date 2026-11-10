<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { NOW, activity } from '../../../stories/mock.js'
  import ActivityFeed from './ActivityFeed.svelte'

  const { Story } = defineMeta({
    title: 'Kodama/ActivityFeed',
    component: ActivityFeed,
    tags: ['autodocs'],
    args: { items: activity, now: NOW, compact: false },
    argTypes: {
      compact: { control: 'boolean' },
      items: { control: false },
      now: { control: false },
    },
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'What an agent did while nobody was watching, newest first: the time (09:00 today, 昨日 yesterday, then 10/28), a node, and what happened. Nodes are icons for alarms and cron (clock), other agents (arrows), memory (book), and configuration (sliders); an event still going has the running dot, and a failure the destructive dot and subject. Source: `design/components/ActivityFeed`.',
        },
      },
    },
  })
</script>

<Story name="Feed" />

<Story name="Compact" args={{ compact: true }} />
