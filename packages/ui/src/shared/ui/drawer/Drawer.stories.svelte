<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Button } from '../button/index.js'
  import * as Field from '../field/index.js'
  import { Input } from '../input/index.js'
  import * as Drawer from './index.js'
  import DrawerContent from './DrawerContent.svelte'

  const { Story } = defineMeta({
    title: 'Patterns/Drawer',
    component: DrawerContent,
    tags: ['autodocs'],
    args: { side: 'right' },
    argTypes: {
      side: { control: 'inline-radio', options: ['right', 'left', 'bottom'] },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A Dialog pinned to an edge of the viewport, for side content such as settings or details. It is the same native modal: the page behind is inert, focus is trapped and returned, and Esc, the backdrop, and the × close it. It slides in from `side` only without a reduced-motion request; otherwise it fades. The footer sits at the bottom of the drawer.',
        },
      },
    },
  })
</script>

<Story name="Default">
  {#snippet template(args)}
    <Drawer.Root>
      <Drawer.Trigger>通知の設定</Drawer.Trigger>
      <Drawer.Content {...args}>
        <Drawer.Header>
          <Drawer.Title>通知の設定</Drawer.Title>
          <Drawer.Description>通知の受け取り方を選べます</Drawer.Description>
        </Drawer.Header>
      </Drawer.Content>
    </Drawer.Root>
  {/snippet}
</Story>

<Story name="Edit profile" asChild>
  <Drawer.Root>
    <Drawer.Trigger>プロフィールを編集</Drawer.Trigger>
    <Drawer.Content>
      <Drawer.Header>
        <Drawer.Title>プロフィールを編集</Drawer.Title>
        <Drawer.Description>変更は保存するまで反映されません</Drawer.Description>
      </Drawer.Header>
      <Field.Set>
        <Field.Root>
          <Field.Label>表示名</Field.Label>
          <Input name="display-name" value="山田 花子" autocomplete="name" />
        </Field.Root>
        <Field.Root>
          <Field.Label>メールアドレス</Field.Label>
          <Input name="email" type="email" value="hanako@example.com" autocomplete="email" />
        </Field.Root>
      </Field.Set>
      <Drawer.Footer>
        <Drawer.Close>キャンセル</Drawer.Close>
        <Button>保存</Button>
      </Drawer.Footer>
    </Drawer.Content>
  </Drawer.Root>
</Story>
