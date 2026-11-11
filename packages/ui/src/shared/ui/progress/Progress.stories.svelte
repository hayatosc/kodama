<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Field from '../field/index.js'
  import Progress from './progress.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Progress',
    component: Progress,
    tags: ['autodocs'],
    args: { value: 40, max: 100 },
    parameters: {
      docs: {
        description: {
          component:
            'How far a task has come, on the native `<progress>`, which screen readers announce with its value. Name it with a label (a Field links one), and show the value in text too. Without `value` it is indeterminate: use that only briefly, until the length is known, and prefer a Spinner otherwise. Never move focus to it; announce the end in a `role="status"` region.',
        },
      },
    },
  })
</script>

<Story name="Default">
  {#snippet template(args)}
    <Progress {...args} aria-label="アップロード" class="w-72" />
  {/snippet}
</Story>

<Story name="With a label">
  {#snippet template(args)}
    <Field.Root class="w-72">
      <div class="flex items-center justify-between">
        <Field.Label>記憶を整理しています</Field.Label>
        <span class="text-sm tabular-nums text-muted-foreground">{args.value}%</span>
      </div>
      <Progress {...args} />
    </Field.Root>
  {/snippet}
</Story>

<Story
  name="Indeterminate"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'No value yet: a segment slides along the track, and slows down under a reduced-motion request.',
      },
    },
  }}
>
  <Field.Root class="w-72">
    <Field.Label>ファイルを準備しています</Field.Label>
    <Progress />
  </Field.Root>
</Story>
