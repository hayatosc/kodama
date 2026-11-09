<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import { Switch } from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Switch',
    component: Switch,
    tags: ['autodocs'],
    args: { checked: false, disabled: false, 'aria-label': 'web_search', onCheckedChange: fn() },
    argTypes: {
      checked: { control: 'boolean' },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A switch that takes effect the moment it is pressed, such as turning a tool on or off. Settings that need a save button use a checkbox instead. On is inverted (the primary color); Space toggles it. Disabled is 40% opacity, and the row says why. Source: `design/components/Switch`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let tools = $state([
    {
      name: 'web_search',
      description: 'ウェブを検索して結果を要約します',
      enabled: true,
      locked: false,
    },
    { name: 'fetch', description: 'URL の本文を取得します', enabled: false, locked: false },
    {
      name: 'remember',
      description: '記憶を保存します。システムが管理しているため変更できません',
      enabled: true,
      locked: true,
    },
  ])
</script>

<Story name="Off" />

<Story name="On" args={{ checked: true }} />

<Story name="Disabled" args={{ checked: true, disabled: true }} />

<Story
  name="Tool list"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'How the Tools tab uses it: the tool name in mono, a description, and the switch at the right. A system-managed tool keeps its switch, disabled.',
      },
    },
  }}
>
  <ul class="flex w-80 flex-col">
    {#each tools as tool (tool.name)}
      <li class="flex items-center gap-3 px-2.5 py-2">
        <label for={`tool-${tool.name}`} class="min-w-0 flex-1">
          <b class="block font-mono text-sm font-semibold">{tool.name}</b>
          <small class="block text-xs text-muted-foreground">{tool.description}</small>
        </label>
        <Switch id={`tool-${tool.name}`} bind:checked={tool.enabled} disabled={tool.locked} />
      </li>
    {/each}
  </ul>
</Story>
