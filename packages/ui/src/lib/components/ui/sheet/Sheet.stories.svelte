<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Button } from '../button/index.js'
  import * as Field from '../field/index.js'
  import { Input } from '../input/index.js'
  import * as Sheet from './index.js'
  import SheetContent from './sheet-content.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Sheet',
    component: SheetContent,
    tags: ['autodocs'],
    argTypes: {
      side: { control: 'inline-radio', options: ['right', 'left', 'bottom'] },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A Dialog pinned to an edge of the viewport, for side content such as settings or details. It is the same native modal: the page behind is inert, focus is trapped and returned, and Esc, the backdrop, and the × close it. It slides in from `side` only without a reduced-motion request; otherwise it fades. The footer sits at the bottom of the sheet.',
        },
      },
    },
  })
</script>

{#snippet profile(side: 'right' | 'left' | 'bottom', label: string)}
  <Sheet.Root>
    <Sheet.Trigger>{label}</Sheet.Trigger>
    <Sheet.Content {side}>
      <Sheet.Header>
        <Sheet.Title>プロフィールを編集</Sheet.Title>
        <Sheet.Description>変更は保存するまで反映されません。</Sheet.Description>
      </Sheet.Header>
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
      <Sheet.Footer>
        <Sheet.Close>キャンセル</Sheet.Close>
        <Button>保存</Button>
      </Sheet.Footer>
    </Sheet.Content>
  </Sheet.Root>
{/snippet}

<Story name="Right" asChild>
  {@render profile('right', '右から開く')}
</Story>

<Story name="Left" asChild>
  {@render profile('left', '左から開く')}
</Story>

<Story name="Bottom" asChild>
  {@render profile('bottom', '下から開く')}
</Story>
