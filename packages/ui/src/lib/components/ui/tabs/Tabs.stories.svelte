<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Tabs from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Tabs',
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'The right pane’s tabs: 詳細 (Details), 記憶 (Memory), and ツール (Tools). The selected tab sits on muted; the others are muted text that darkens on hover. Arrow keys move between tabs. The panel contents here are placeholders until the Panel parts step. Source: `design/components/Tabs`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let tab = $state('details')
</script>

<Story name="Profile tabs" asChild>
  <Tabs.Root bind:value={tab} class="w-80">
    <Tabs.List aria-label="エージェントの情報">
      <Tabs.Trigger value="details">詳細</Tabs.Trigger>
      <Tabs.Trigger value="memory">記憶</Tabs.Trigger>
      <Tabs.Trigger value="tools">ツール</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="details">
      <p class="text-sm text-muted-foreground">プロバイダー、モデル、ルーティン、アクティビティ</p>
    </Tabs.Content>
    <Tabs.Content value="memory">
      <p class="text-sm text-muted-foreground">記憶の検索と一覧</p>
    </Tabs.Content>
    <Tabs.Content value="tools">
      <p class="text-sm text-muted-foreground">ツールの一覧とスイッチ</p>
    </Tabs.Content>
  </Tabs.Root>
</Story>
