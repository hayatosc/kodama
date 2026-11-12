<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Field from '../field/index.js'
  import * as RadioGroup from './index.js'
  import RadioGroupRoot from './RadioGroup.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/RadioGroup',
    component: RadioGroupRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'One choice among two to five options, all visible at once; more options belong in a Select. **RadioGroup.Root** holds the value and gives every **Item**, a native radio, the same name, so arrow keys move the choice and the form submits it. Name the group with its legend. The chosen radio fills with primary and shows a dot.',
        },
      },
    },
  })

  const intervals = [
    { value: 'hourly', label: '1 時間ごと' },
    { value: 'daily', label: '毎日' },
    { value: 'weekly', label: '毎週' },
  ]
</script>

<script lang="ts">
  let interval = $state('daily')
  let density = $state('comfortable')
</script>

<Story name="Default" asChild>
  <Field.Set class="w-64 gap-0">
    <Field.Legend id="radio-interval">実行の間隔</Field.Legend>
    <RadioGroup.Root bind:value={interval} name="interval" aria-labelledby="radio-interval">
      {#each intervals as option (option.value)}
        <Field.Root orientation="horizontal">
          <RadioGroup.Item value={option.value} />
          <Field.Label>{option.label}</Field.Label>
        </Field.Root>
      {/each}
    </RadioGroup.Root>
  </Field.Set>
</Story>

<Story
  name="With descriptions"
  asChild
  parameters={{
    docs: { description: { story: 'Each option with a line that says what it means.' } },
  }}
>
  <Field.Set class="w-80 gap-0">
    <Field.Legend id="radio-density">表示の密度</Field.Legend>
    <RadioGroup.Root bind:value={density} name="density" aria-labelledby="radio-density">
      <Field.Root orientation="horizontal">
        <RadioGroup.Item value="comfortable" />
        <Field.Content>
          <Field.Label>ゆったり</Field.Label>
          <Field.Description>行の間をあけて読みやすくします</Field.Description>
        </Field.Content>
      </Field.Root>
      <Field.Root orientation="horizontal">
        <RadioGroup.Item value="compact" />
        <Field.Content>
          <Field.Label>詰める</Field.Label>
          <Field.Description>一度に多くの行を表示します</Field.Description>
        </Field.Content>
      </Field.Root>
    </RadioGroup.Root>
  </Field.Set>
</Story>

<Story
  name="Disabled"
  asChild
  parameters={{
    docs: { description: { story: 'The whole group disabled, at 40% opacity.' } },
  }}
>
  <Field.Set class="w-64 gap-0" disabled>
    <Field.Legend id="radio-region">リージョン</Field.Legend>
    <RadioGroup.Root value="tokyo" name="region" aria-labelledby="radio-region" disabled>
      <Field.Root orientation="horizontal">
        <RadioGroup.Item value="tokyo" />
        <Field.Label>東京</Field.Label>
      </Field.Root>
      <Field.Root orientation="horizontal">
        <RadioGroup.Item value="osaka" />
        <Field.Label>大阪</Field.Label>
      </Field.Root>
    </RadioGroup.Root>
  </Field.Set>
</Story>
