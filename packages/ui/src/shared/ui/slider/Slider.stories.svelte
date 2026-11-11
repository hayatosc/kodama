<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import * as Field from '../field/index.js'
  import Slider from './slider.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Slider',
    component: Slider,
    tags: ['autodocs'],
    args: { value: 40, min: 0, max: 100, step: 1, disabled: false },
    parameters: {
      docs: {
        description: {
          component:
            'A native range input with the design’s track and thumb, for a value where the rough position matters more than the exact number. The browser keeps the arrow keys, Page Up/Down, Home/End, pointer, and touch. Show the value in text beside it, and set `aria-valuetext` when it needs a unit.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let temperature = $state(0.7)
  let retention = $state(30)
</script>

<Story name="Default">
  {#snippet template(args)}
    <Field.Root class="w-72">
      <Field.Label>音量</Field.Label>
      <Slider {...args} name="volume" />
    </Field.Root>
  {/snippet}
</Story>

<Story
  name="With value"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The value in text next to the label, and a step of 0.1. `aria-valuetext` reads the same text.',
      },
    },
  }}
>
  <Field.Root class="w-72">
    <div class="flex items-center justify-between">
      <Field.Label>温度</Field.Label>
      <output class="font-mono text-sm tabular-nums">{temperature.toFixed(1)}</output>
    </div>
    <Slider
      name="temperature"
      min={0}
      max={2}
      step={0.1}
      bind:value={temperature}
      aria-valuetext={temperature.toFixed(1)}
    />
    <Field.Description>高いほど返答に幅が出ます。</Field.Description>
  </Field.Root>
</Story>

<Story
  name="With unit"
  asChild
  parameters={{
    docs: { description: { story: 'A value with a unit, spoken through `aria-valuetext`.' } },
  }}
>
  <Field.Root class="w-72">
    <div class="flex items-center justify-between">
      <Field.Label>会話の保存期間</Field.Label>
      <output class="text-sm tabular-nums">{retention} 日</output>
    </div>
    <Slider
      name="retention"
      min={7}
      max={90}
      bind:value={retention}
      aria-valuetext={`${retention} 日`}
    />
  </Field.Root>
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template(args)}
    <Field.Root class="w-72">
      <Field.Label>音量</Field.Label>
      <Slider {...args} name="volume-locked" />
    </Field.Root>
  {/snippet}
</Story>
