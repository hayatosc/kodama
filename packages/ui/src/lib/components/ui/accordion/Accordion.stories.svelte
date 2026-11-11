<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import AccordionRoot from './accordion.svelte'
  import * as Accordion from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Accordion',
    component: AccordionRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'Sections that open and close, built on `<details>` and `<summary>`: the browser makes each trigger a button that Enter and Space toggle, and closed content stays findable with find-in-page. There are no arrow keys between triggers, so arrow keys keep scrolling. The chevron sits right before each label. By default any number of items can be open, which lets readers compare them; `type="single"` closes the open item when another opens (`<details name>`). The content slides open only without a reduced-motion request. An Item on its own is one section that opens and closes, for details most readers can skip.',
        },
      },
    },
  })

  const questions = [
    {
      q: 'エージェントは何体まで作れますか？',
      a: 'プランごとに上限があります。無料プランでは 1 体、プロプランでは 10 体まで作れます。',
    },
    {
      q: '会話はどこに保存されますか？',
      a: 'エージェントごとの領域に保存され、ほかのエージェントからは読めません。共有したい内容は記憶として残します。',
    },
    {
      q: 'アーカイブしたエージェントは戻せますか？',
      a: 'はい。アーカイブ中は返信やアラームが止まりますが、会話と記憶は残り、いつでも元に戻せます。',
    },
  ]
</script>

<script lang="ts">
  let open = $state(false)
</script>

<Story name="Default" asChild>
  <Accordion.Root class="w-96" aria-label="よくある質問">
    {#each questions as item (item.q)}
      <Accordion.Item>
        <Accordion.Trigger>{item.q}</Accordion.Trigger>
        <Accordion.Content>{item.a}</Accordion.Content>
      </Accordion.Item>
    {/each}
  </Accordion.Root>
</Story>

<Story
  name="Single"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '`type="single"`: opening one item closes the other. Use it only when the layout needs it, since readers cannot compare items.',
      },
    },
  }}
>
  <Accordion.Root type="single" class="w-96" aria-label="よくある質問">
    {#each questions as item, index (item.q)}
      <Accordion.Item open={index === 0}>
        <Accordion.Trigger>{item.q}</Accordion.Trigger>
        <Accordion.Content>{item.a}</Accordion.Content>
      </Accordion.Item>
    {/each}
  </Accordion.Root>
</Story>

<Story
  name="One section"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'An Item without a Root: one section that opens and closes, for details most readers can skip. `bind:open` reads or sets the state.',
      },
    },
  }}
>
  <Accordion.Item class="w-96 border-0" bind:open>
    <Accordion.Trigger class="font-normal">
      詳しい設定（{open ? '開いています' : '閉じています'}）
    </Accordion.Trigger>
    <Accordion.Content class="flex flex-col gap-1">
      <p>タイムアウト: 30 秒</p>
      <p>再試行: 3 回まで</p>
      <p>ログの保存: 7 日</p>
    </Accordion.Content>
  </Accordion.Item>
</Story>
