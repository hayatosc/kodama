<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import CollapsibleRoot from './collapsible.svelte'
  import * as Collapsible from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Collapsible',
    component: CollapsibleRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'One section that opens and closes, on `<details>` and `<summary>`, for details most readers can skip. `bind:open` reads or sets the state. Several in a row make an Accordion.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let open = $state(false)
</script>

<Story name="Default" asChild>
  <Collapsible.Root class="w-96" bind:open>
    <Collapsible.Trigger>詳しい設定（{open ? '開いています' : '閉じています'}）</Collapsible.Trigger
    >
    <Collapsible.Content class="mt-2 flex flex-col gap-1 ps-6 text-sm text-muted-foreground">
      <p>タイムアウト: 30 秒</p>
      <p>再試行: 3 回まで</p>
      <p>ログの保存: 7 日</p>
    </Collapsible.Content>
  </Collapsible.Root>
</Story>
