<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import BellIcon from '@lucide/svelte/icons/bell'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import { Badge } from '../badge/index.js'
  import { Button } from '../button/index.js'
  import { Switch } from '../switch/index.js'
  import * as Item from './index.js'
  import ItemRoot from './item.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Item',
    component: ItemRoot,
    tags: ['autodocs'],
    args: { variant: 'plain', size: 'default' },
    argTypes: {
      variant: { control: 'inline-radio', options: ['plain', 'outline', 'muted'] },
      size: { control: 'inline-radio', options: ['default', 'sm'] },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A row: **Media** (an icon or avatar), **Content** with a **Title** and **Description**, and **Actions** at the end. **Group** makes a native list, so screen readers announce how many items it holds. To make a whole row open something, put a link or button in the Title: its hit area stretches over the row and the row highlights on hover, while the actions stay above it as separate controls.',
        },
      },
    },
  })

  const files = [
    { name: '議事録_1110.md', note: '2 時間前に research が作成' },
    { name: '朝の要約.md', note: '今日 7:00 に assistant が作成' },
    { name: '調査メモ.md', note: '昨日 scheduler が更新' },
  ]
</script>

<Story name="Default">
  {#snippet template(args)}
    <Item.Root {...args} class="w-96">
      <Item.Content>
        <Item.Title>項目</Item.Title>
      </Item.Content>
    </Item.Root>
  {/snippet}
</Story>

<Story name="With a switch">
  {#snippet template(args)}
    <Item.Root {...args} class="w-96">
      <Item.Media><BellIcon strokeWidth={1.75} aria-hidden="true" /></Item.Media>
      <Item.Content>
        <Item.Title>朝の要約</Item.Title>
        <Item.Description>毎日 7:00 に、前日の会話をまとめます。</Item.Description>
      </Item.Content>
      <Item.Actions><Switch aria-label="朝の要約" checked /></Item.Actions>
    </Item.Root>
  {/snippet}
</Story>

<Story
  name="Group of links"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A list whose rows each open a file. The button in the title covers the row; the badge is just text.',
      },
    },
  }}
>
  <Item.Group class="w-96 gap-1">
    {#each files as file (file.name)}
      <Item.Root size="sm">
        <Item.Media><FileTextIcon strokeWidth={1.75} aria-hidden="true" /></Item.Media>
        <Item.Content>
          <Item.Title><button type="button">{file.name}</button></Item.Title>
          <Item.Description>{file.note}</Item.Description>
        </Item.Content>
        <ChevronRightIcon
          class="size-4 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </Item.Root>
    {/each}
  </Item.Group>
</Story>

<Story
  name="Outline"
  asChild
  parameters={{
    docs: {
      description: { story: 'Outlined rows, with a badge and an action in the end column.' },
    },
  }}
>
  <Item.Group class="w-96 gap-2">
    <Item.Root variant="outline">
      <Item.Content>
        <Item.Title>Anthropic <Badge variant="live">接続済み</Badge></Item.Title>
        <Item.Description>キーは暗号化して保存されています。</Item.Description>
      </Item.Content>
      <Item.Actions><Button variant="secondary" size="sm">管理</Button></Item.Actions>
    </Item.Root>
    <Item.Root variant="outline">
      <Item.Content>
        <Item.Title>OpenAI</Item.Title>
        <Item.Description>まだ接続していません。</Item.Description>
      </Item.Content>
      <Item.Actions><Button size="sm">接続</Button></Item.Actions>
    </Item.Root>
  </Item.Group>
</Story>
