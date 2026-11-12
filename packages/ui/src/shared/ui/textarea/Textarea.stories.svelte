<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Field from '../field/index.js'
  import Textarea from './Textarea.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Textarea',
    component: Textarea,
    tags: ['autodocs'],
    args: { disabled: false },
    parameters: {
      docs: {
        description: {
          component:
            'A native textarea for longer text. It grows with its content (`field-sizing: content`) from three lines up to ten, then scrolls; its width stays fixed, and it can still be resized by hand. Like Input, it links to its Field and shows errors only after interaction.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let note = $state('')
</script>

<Story name="Default">
  {#snippet template(args)}
    <Field.Root class="w-80">
      <Field.Label>メモ</Field.Label>
      <Textarea {...args} name="note" />
    </Field.Root>
  {/snippet}
</Story>

<Story
  name="With description"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'A limit in the description, and the count kept in step with the text.',
      },
    },
  }}
>
  <Field.Root class="w-80">
    <Field.Label>エージェントへの指示</Field.Label>
    <Textarea name="instructions" maxlength={500} bind:value={note} />
    <Field.Description>500 文字まで（{note.length} / 500）</Field.Description>
  </Field.Root>
</Story>

<Story name="Disabled" args={{ disabled: true, value: '管理者が設定した指示です' }}>
  {#snippet template(args)}
    <Field.Root class="w-80">
      <Field.Label>共通の指示</Field.Label>
      <Textarea {...args} name="shared" />
    </Field.Root>
  {/snippet}
</Story>
