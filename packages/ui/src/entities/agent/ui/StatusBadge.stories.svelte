<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import StatusBadge from './StatusBadge.svelte'
  import { RUN_STATES } from '../model/status.js'

  const { Story } = defineMeta({
    title: 'Kodama/StatusBadge',
    component: StatusBadge,
    tags: ['autodocs'],
    args: { status: 'running', dotOnly: false },
    argTypes: {
      status: { control: 'select', options: RUN_STATES },
      label: { control: 'text' },
      dotOnly: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'An agent’s run state as a dot and a word: 稼働中, 実行中, 待機中, 一時停止, 失敗, 完了, アーカイブ. The dot’s shape differs too (filled, a hollow circle while queued, a hollow square while paused), so no state is told by color alone. Pane headings and the profile panel use the badge; list rows use the dot alone, which screen readers still read as its word. The running dot blinks and holds still under reduced motion. Source: `design/components/StatusBadge`.',
        },
      },
    },
  })
</script>

<Story name="Default" />

<Story
  name="States"
  asChild
  parameters={{
    docs: {
      description: { story: 'Every state as a badge, and below it as the dot list rows show.' },
    },
  }}
>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-2">
      {#each RUN_STATES as status (status)}
        <StatusBadge {status} />
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
      {#each RUN_STATES as status (status)}
        <span class="inline-flex items-center gap-1.5"
          ><StatusBadge {status} dotOnly /><span aria-hidden="true">{status}</span></span
        >
      {/each}
    </div>
  </div>
</Story>
