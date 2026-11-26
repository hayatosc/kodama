<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import Combobox from './Combobox.svelte'
  import type { ComboboxOption } from './options.js'
  import { regions } from '../command/prefectures.js'

  const prefectures: ComboboxOption[] = regions.flatMap((region) =>
    region.prefectures.map((name) => ({ value: name })),
  )
  const byRegion: ComboboxOption[] = regions.flatMap((region) =>
    region.prefectures.map((name) => ({ value: name, group: region.name })),
  )
  const models: ComboboxOption[] = [
    ...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((value) => ({
      value,
      group: '最新',
    })),
    ...['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'].map((value) => ({
      value,
      group: '以前のモデル',
    })),
  ]

  const { Story } = defineMeta({
    title: 'Primitives/Combobox',
    component: Combobox,
    tags: ['autodocs'],
    args: { label: '都道府県', options: prefectures, variant: 'field', disabled: false },
    argTypes: {
      variant: { control: 'inline-radio', options: ['field', 'inline'] },
      disabled: { control: 'boolean' },
      mono: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'A searchable select for a long list, built from Popover and Command. The trigger opens it with the search field focused; typing filters, arrow keys move, Enter chooses and closes, and Esc or a click outside closes it and returns focus to the trigger. Options can sit under group headings. The trigger is named by the label and the current value together. `field` is outlined, for forms; `inline` has no outline and lines up to the right, for a settings row. For a short list, use Select. Source: `design/components/Select`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let region = $state('大阪府')
  let model = $state('claude-sonnet-5-5')
</script>

<Story name="Default" />

<Story
  name="Groups"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Options under group headings, with a line between groups. Search covers every group; a group with no match hides.',
      },
    },
  }}
>
  <Combobox label="都道府県" options={byRegion} bind:value={region} />
</Story>

<Story
  name="Inline"
  asChild
  parameters={{
    layout: 'padded',
    docs: {
      description: {
        story:
          'No outline, for the right edge of a settings row; the menu lines up with the trigger’s right edge. Model names are monospaced.',
      },
    },
  }}
>
  <div
    class="flex min-h-10 w-80 max-w-full items-center justify-between gap-3 rounded-xl border border-border ps-3 pe-2 text-sm"
  >
    <span>モデル</span>
    <Combobox label="モデル" options={models} variant="inline" mono bind:value={model} />
  </div>
</Story>

<Story
  name="Disabled"
  args={{ disabled: true, value: '東京都' }}
  parameters={{
    docs: { description: { story: 'A disabled trigger does not open, at 40% opacity.' } },
  }}
/>
