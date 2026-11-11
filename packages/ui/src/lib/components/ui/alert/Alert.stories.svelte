<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import InfoIcon from '@lucide/svelte/icons/info'
  import LoaderIcon from '@lucide/svelte/icons/loader'
  import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert'
  import AlertRoot from './alert.svelte'
  import * as Alert from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Alert',
    component: AlertRoot,
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
    <Alert.Root {...args} class="w-96">
      <InfoIcon strokeWidth={1.75} aria-hidden="true" />
      <Alert.Title>メンテナンスのお知らせ</Alert.Title>
      <Alert.Description
        >11 月 15 日 2:00〜4:00 は、エージェントが返信できません。</Alert.Description
      >
    </Alert.Root>
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
    <Alert.Root variant="live">
      <InfoIcon strokeWidth={1.75} aria-hidden="true" />
      <Alert.Title>新しいモデルを使えます</Alert.Title>
      <Alert.Description>設定のモデルから選べます。</Alert.Description>
    </Alert.Root>
    <Alert.Root variant="running">
      <TriangleAlertIcon strokeWidth={1.75} aria-hidden="true" />
      <Alert.Title>利用上限に近づいています</Alert.Title>
      <Alert.Description>今月の上限の 90% を使いました。</Alert.Description>
    </Alert.Root>
    <Alert.Root variant="destructive">
      <CircleAlertIcon strokeWidth={1.75} aria-hidden="true" />
      <Alert.Title>API キーが無効です</Alert.Title>
      <Alert.Description>プロバイダーの設定で、新しいキーを登録してください。</Alert.Description>
    </Alert.Root>
  </div>
</Story>

<Story
  name="Without an icon"
  asChild
  parameters={{ docs: { description: { story: 'Just the text; the icon column collapses.' } } }}
>
  <Alert.Root class="w-96">
    <Alert.Description>この会話は 30 日後に自動で整理されます。</Alert.Description>
  </Alert.Root>
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
    <Alert.Root>
      <LoaderIcon strokeWidth={1.75} aria-hidden="true" />
      <Alert.Title>同期しています</Alert.Title>
    </Alert.Root>
  </div>
</Story>
