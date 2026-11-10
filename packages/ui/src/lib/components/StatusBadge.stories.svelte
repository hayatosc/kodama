<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import StatusBadge from './StatusBadge.svelte'
  import { RUN_STATE_LABELS, type RunState } from './types.js'
  import UnreadCount from './UnreadCount.svelte'

  const states: RunState[] = ['live', 'running', 'queued', 'paused', 'error', 'done', 'archived']

  const { Story } = defineMeta({
    title: 'Primitives/StatusBadge',
    component: StatusBadge,
    tags: ['autodocs'],
    args: { status: 'running', dotOnly: false },
    argTypes: {
      status: { control: 'select', options: states },
      label: { control: 'text' },
      dotOnly: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'An agent’s lifecycle and run state as a dot and a word. Only three states have a color (live, running, error); the rest stay neutral, because success should be quiet. Color is never the only signal: the dot’s shape (filled, hollow circle, hollow square) and the word always come with it. The running dot blinks, except under reduced motion. Source: `design/components/StatusBadge`.',
        },
      },
    },
  })
</script>

<Story name="Badge" />

<Story name="Dot only" args={{ dotOnly: true }} />

<Story
  name="All states"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Pane headings and the detail panel use the badge. Sidebar rows use the dot alone, next to a second line that says the state in words.',
      },
    },
  }}
>
  <table class="border-separate border-spacing-x-6 border-spacing-y-2">
    <thead>
      <tr class="text-left text-xs text-muted-foreground">
        <th class="font-normal">status</th>
        <th class="font-normal">Badge</th>
        <th class="font-normal">Dot</th>
      </tr>
    </thead>
    <tbody>
      {#each states as status (status)}
        <tr>
          <td><code class="mono-xs">{status}</code></td>
          <td><StatusBadge {status} /></td>
          <td><StatusBadge {status} dotOnly /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</Story>

<Story
  name="Unread count"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The unread count sits at the right edge of a sidebar row. It disappears at 0 and caps at 99+.',
      },
    },
  }}
>
  <div class="flex flex-col gap-2">
    {#each [0, 1, 12, 99, 100] as count (count)}
      <div class="flex w-64 items-center justify-between rounded-xl px-3 py-2 hover:bg-accent">
        <span class="text-sm">{count === 0 ? '既読' : `${count} 件`}</span>
        <UnreadCount {count} />
      </div>
    {/each}
  </div>
</Story>

<Story name="Custom label" args={{ status: 'live', label: RUN_STATE_LABELS.live + '（3 件）' }} />
