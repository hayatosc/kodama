<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import InfoIcon from '@lucide/svelte/icons/info'
  import LoaderIcon from '@lucide/svelte/icons/loader'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import CalloutRoot from './Callout.svelte'
  import * as Callout from './index.js'

  const { Story } = defineMeta({
    title: 'Patterns/Callout',
    component: CalloutRoot,
    tags: ['autodocs'],
    args: { variant: 'neutral' },
    argTypes: {
      variant: {
        control: 'inline-radio',
        options: ['neutral', 'live', 'running', 'destructive'],
      },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A message in the page: an optional icon, a **Title**, and a **Description**. The tone colors the border, the background, and the icon, and the icon and the words carry the meaning too, never color alone. It has no role of its own; a message that appears later goes inside a live region (`role="status"`, or `role="alert"` when it cannot wait).',
        },
      },
    },
  })
</script>

<Story name="Default">
  {#snippet template(args)}
    <Callout.Root {...args} class="w-96">
      <Callout.Title>メンテナンスのお知らせ</Callout.Title>
      <Callout.Description>11 月 15 日 2:00〜4:00 は返信できません</Callout.Description>
    </Callout.Root>
  {/snippet}
</Story>

<Story name="With an icon">
  {#snippet template(args)}
    <Callout.Root {...args} class="w-96">
      <InfoIcon strokeWidth={1.75} aria-hidden="true" />
      <Callout.Title>メンテナンスのお知らせ</Callout.Title>
      <Callout.Description
        >11 月 15 日 2:00〜4:00 は、エージェントが返信できません</Callout.Description
      >
    </Callout.Root>
  {/snippet}
</Story>

<Story
  name="Tones"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '**live** for news, **running** for something that needs attention soon, **destructive** for a failure.',
      },
    },
  }}
>
  <div class="flex w-96 flex-col gap-3">
    <Callout.Root variant="live">
      <InfoIcon strokeWidth={1.75} aria-hidden="true" />
      <Callout.Title>新しいモデルを使えます</Callout.Title>
      <Callout.Description>設定のモデルから選べます</Callout.Description>
    </Callout.Root>
    <Callout.Root variant="running">
      <TriangleAlertIcon strokeWidth={1.75} aria-hidden="true" />
      <Callout.Title>利用上限に近づいています</Callout.Title>
      <Callout.Description>今月の上限の 90% を使いました</Callout.Description>
    </Callout.Root>
    <Callout.Root variant="destructive">
      <CircleAlertIcon strokeWidth={1.75} aria-hidden="true" />
      <Callout.Title>API キーが無効です</Callout.Title>
      <Callout.Description>プロバイダーの設定で、新しいキーを登録してください</Callout.Description>
    </Callout.Root>
  </div>
</Story>

<Story
  name="Description only"
  asChild
  parameters={{ docs: { description: { story: 'A description without a title.' } } }}
>
  <Callout.Root class="w-96">
    <Callout.Description>この会話は 30 日後に自動で整理されます</Callout.Description>
  </Callout.Root>
</Story>

<Story
  name="Announced"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A message that appears while the user works goes inside a polite live region, which exists before the message does.',
      },
    },
  }}
>
  <div role="status" class="w-96">
    <Callout.Root>
      <LoaderIcon strokeWidth={1.75} aria-hidden="true" />
      <Callout.Title>同期しています</Callout.Title>
    </Callout.Root>
  </div>
</Story>
