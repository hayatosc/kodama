<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import Select, { type SelectOption } from './Select.svelte'

  const providers: SelectOption[] = [
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai', label: 'OpenAI' },
    { value: 'google', label: 'Google' },
  ]

  const models: SelectOption[] = [
    { value: 'claude-opus-5-5', label: 'claude-opus-5-5', group: '最新' },
    { value: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5', group: '最新' },
    { value: 'claude-haiku-5-5', label: 'claude-haiku-5-5', group: '最新' },
    { value: 'claude-opus-5', label: 'claude-opus-5', group: '以前のモデル' },
    { value: 'claude-sonnet-5', label: 'claude-sonnet-5', group: '以前のモデル' },
    { value: 'claude-haiku-5', label: 'claude-haiku-5', group: '以前のモデル' },
    { value: 'claude-opus-4-7', label: 'claude-opus-4-7', group: '以前のモデル' },
    { value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', group: '以前のモデル' },
    {
      value: 'claude-3-haiku',
      label: 'claude-3-haiku',
      hint: '提供終了',
      disabled: true,
      group: '以前のモデル',
    },
  ]

  const { Story } = defineMeta({
    title: 'Primitives/Select',
    component: Select,
    tags: ['autodocs'],
    args: {
      options: providers,
      value: 'anthropic',
      variant: 'field',
      label: 'プロバイダー',
      onchange: fn(),
    },
    argTypes: {
      variant: { control: 'inline-radio', options: ['field', 'inline'] },
      searchable: { control: 'boolean' },
      mono: { control: 'boolean' },
      options: { control: false },
    },
    parameters: {
      docs: {
        description: {
          component:
            'Picks one option from a menu. Lists longer than 8 get a search field, focused on open; typing filters by label, Enter picks the first match, and Esc or a click outside closes. Groups get a muted heading, and the current value has a check. **field** has a border, for forms; **inline** sits at the right edge of a settings row. Source: `design/components/Select`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let model = $state('claude-sonnet-5-5')
  let provider = $state('anthropic')
</script>

<Story name="Provider" />

<Story
  name="Model"
  args={{ options: models, value: 'claude-sonnet-5-5', mono: true, label: 'モデル' }}
/>

<Story name="Empty" args={{ value: undefined, placeholder: 'プロバイダーを選択' }} />

<Story
  name="In a settings row"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The inline trigger at the right edge of settings rows, as the profile panel’s Details tab uses it.',
      },
    },
  }}
>
  <div class="w-80 rounded-xl border border-border py-1">
    <div class="flex min-h-10 items-center justify-between gap-3 pr-2 pl-3 text-sm">
      <span>プロバイダー</span>
      <Select options={providers} bind:value={provider} variant="inline" label="プロバイダー" />
    </div>
    <div
      class="flex min-h-10 items-center justify-between gap-3 border-t border-border pr-2 pl-3 text-sm"
    >
      <span>モデル</span>
      <Select options={models} bind:value={model} variant="inline" mono label="モデル" />
    </div>
  </div>
</Story>
