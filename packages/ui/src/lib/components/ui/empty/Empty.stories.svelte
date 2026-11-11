<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import BrainIcon from '@lucide/svelte/icons/brain'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import SearchXIcon from '@lucide/svelte/icons/search-x'
  import { Button } from '../button/index.js'
  import EmptyRoot from './empty.svelte'
  import * as Empty from './index.js'

  const { Story } = defineMeta({
    title: 'Patterns/Empty',
    component: EmptyRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'What a place shows while it has nothing in it: an icon, a **Title** that says what will appear here, a **Description** of how it fills, and the action that adds the first item, if the user can.',
        },
      },
    },
  })
</script>

<Story name="Default" asChild>
  <Empty.Root class="w-96">
    <Empty.Title>まだ何もありません</Empty.Title>
  </Empty.Root>
</Story>

<Story name="With an action" asChild>
  <Empty.Root class="w-96 border border-dashed border-border">
    <Empty.Media><BrainIcon strokeWidth={1.75} aria-hidden="true" /></Empty.Media>
    <Empty.Title>記憶はまだありません</Empty.Title>
    <Empty.Description>
      会話の中で大事なことが出てくると、エージェントがここに残します。自分で追加することもできます。
    </Empty.Description>
    <Empty.Content>
      <Button size="sm"><PlusIcon strokeWidth={1.75} aria-hidden="true" />記憶を追加</Button>
    </Empty.Content>
  </Empty.Root>
</Story>

<Story
  name="No results"
  asChild
  parameters={{
    docs: { description: { story: 'An empty search: what was searched, and a way back.' } },
  }}
>
  <Empty.Root class="w-96">
    <Empty.Media><SearchXIcon strokeWidth={1.75} aria-hidden="true" /></Empty.Media>
    <Empty.Title>「請求書」に一致する会話はありません</Empty.Title>
    <Empty.Description>別の言葉で探すか、絞り込みを外してください。</Empty.Description>
    <Empty.Content><Button variant="secondary" size="sm">絞り込みを外す</Button></Empty.Content>
  </Empty.Root>
</Story>
