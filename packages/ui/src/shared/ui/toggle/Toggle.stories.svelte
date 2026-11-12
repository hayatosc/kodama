<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import BoldIcon from '@lucide/svelte/icons/bold'
  import ItalicIcon from '@lucide/svelte/icons/italic'
  import { Toggle } from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Toggle',
    component: Toggle,
    tags: ['autodocs'],
    args: { variant: 'plain', size: 'default', disabled: false },
    argTypes: {
      variant: { control: 'inline-radio', options: ['plain', 'outline'] },
      size: { control: 'inline-radio', options: ['default', 'sm'] },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A button that stays pressed, announced with `aria-pressed`, for a setting that is on or off. Its label never changes with the state. Pressed adds a fill and a border in the input color, and takes `Highlight` in forced colors mode.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let bold = $state(true)
</script>

<Story name="Default">
  {#snippet template(args)}
    <Toggle {...args} aria-label="太字" bind:pressed={bold}>
      <BoldIcon strokeWidth={1.75} aria-hidden="true" />
    </Toggle>
  {/snippet}
</Story>

<Story name="Outline" asChild>
  <Toggle variant="outline" aria-label="斜体">
    <ItalicIcon strokeWidth={1.75} aria-hidden="true" />
  </Toggle>
</Story>

<Story name="With text" asChild>
  <Toggle variant="outline">
    <ItalicIcon strokeWidth={1.75} aria-hidden="true" />
    斜体
  </Toggle>
</Story>
