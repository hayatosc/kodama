<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Field from '../field/index.js'
  import Checkbox from './checkbox.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Checkbox',
    component: Checkbox,
    tags: ['autodocs'],
    args: { checked: false, indeterminate: false, disabled: false },
    argTypes: {
      checked: { control: 'boolean' },
      indeterminate: { control: 'boolean' },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A native checkbox, for a choice saved with a form or for picking several items; a setting that applies at once is a Switch. It has a custom look: 16px with a border in the input color, filled with primary when checked, with a check or, for a partial selection, a dash. Space toggles it. Put it before its label, in a 44px row (a horizontal Field does this).',
        },
      },
    },
  })
</script>

<script lang="ts">
  let tools = $state([
    { id: 'web_search', label: 'web_search', checked: true },
    { id: 'fetch', label: 'fetch', checked: false },
    { id: 'remember', label: 'remember', checked: true },
  ])
  const allChecked = $derived(tools.every((tool) => tool.checked))
  const someChecked = $derived(tools.some((tool) => tool.checked) && !allChecked)

  function toggleAll(): void {
    const next = !allChecked
    for (const tool of tools) tool.checked = next
  }
</script>

<Story name="Default">
  {#snippet template(args)}
    <Field.Root orientation="horizontal">
      <Checkbox {...args} name="newsletter" />
      <Field.Label>お知らせメールを受け取る</Field.Label>
    </Field.Root>
  {/snippet}
</Story>

<Story
  name="With description"
  asChild
  parameters={{
    docs: { description: { story: 'A second line under the label, read after it.' } },
  }}
>
  <Field.Root orientation="horizontal" class="w-80">
    <Checkbox name="share" checked />
    <Field.Content>
      <Field.Label>会話を共有する</Field.Label>
      <Field.Description>同じワークスペースのメンバーが読めるようになります</Field.Description>
    </Field.Content>
  </Field.Root>
</Story>

<Story
  name="Select all"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A parent checkbox that shows a dash while only some items are checked (`indeterminate`), and checks or clears them all.',
      },
    },
  }}
>
  <Field.Set class="w-64 gap-0">
    <Field.Legend class="sr-only">有効にするツール</Field.Legend>
    <Field.Root orientation="horizontal">
      <Checkbox checked={allChecked} indeterminate={someChecked} onchange={toggleAll} />
      <Field.Label>すべてのツール</Field.Label>
    </Field.Root>
    {#each tools as tool (tool.id)}
      <Field.Root orientation="horizontal" class="ps-6">
        <Checkbox name="tools" value={tool.id} bind:checked={tool.checked} />
        <Field.Label class="font-mono">{tool.label}</Field.Label>
      </Field.Root>
    {/each}
  </Field.Set>
</Story>

<Story name="Disabled" args={{ disabled: true, checked: true }}>
  {#snippet template(args)}
    <Field.Root orientation="horizontal">
      <Checkbox {...args} name="locked" />
      <Field.Label>管理者が固定した設定</Field.Label>
    </Field.Root>
  {/snippet}
</Story>
