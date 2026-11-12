<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Checkbox } from '../checkbox/index.js'
  import { Input } from '../input/index.js'
  import Label from './Label.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Label',
    component: Label,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A native `<label>`. Point it at its control with `for`, or put both in a Field, which links them on its own. Above a text field it stacks on top; beside a checkbox or radio it comes after the control. A label after a disabled control dims with it.',
        },
      },
    },
  })
</script>

<Story name="Above a field" asChild>
  <div class="flex w-72 flex-col gap-1.5">
    <Label for="label-email">メールアドレス</Label>
    <Input id="label-email" type="email" name="email" autocomplete="email" />
  </div>
</Story>

<Story name="After a checkbox" asChild>
  <div class="flex min-h-11 items-center gap-2">
    <Checkbox id="label-remember" name="remember" />
    <Label for="label-remember">ログイン状態を保持する</Label>
  </div>
</Story>

<Story name="Disabled control" asChild>
  <div class="flex min-h-11 items-center gap-2">
    <Checkbox id="label-locked" name="locked" disabled checked />
    <Label for="label-locked">管理者が固定した設定</Label>
  </div>
</Story>
