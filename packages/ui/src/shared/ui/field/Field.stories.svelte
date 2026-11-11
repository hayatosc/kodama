<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Button } from '../button/index.js'
  import { Checkbox } from '../checkbox/index.js'
  import { Input } from '../input/index.js'
  import * as RadioGroup from '../radio-group/index.js'
  import { Switch } from '../switch/index.js'
  import { Textarea } from '../textarea/index.js'
  import FieldRoot from './field.svelte'
  import * as Field from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Field',
    component: FieldRoot,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A control with its label, description, and error. **Field.Root** makes the ids: its Label points at the control, and the control is described by the Description and the Error, so nothing is wired by hand. **orientation="horizontal"** puts a checkbox or switch beside its text in a 44px row. **Field.Set** and **Field.Legend** group related fields in a native fieldset; **Field.Group** spaces fields apart, wider than a label from its control. **Field.Error** is a polite live region with an icon, so a new message is announced and the error never shows by color alone. Set `invalid` on the Root for errors found outside the browser, such as by the server.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let agentName = $state('')
  let submitted = $state(false)
  const nameError = $derived(
    submitted && agentName.trim() === '' ? '名前を入力してください' : undefined,
  )
  let plan = $state('pro')

  function submit(event: SubmitEvent): void {
    event.preventDefault()
    submitted = true
  }
</script>

<Story name="Default" asChild>
  <Field.Root class="w-72">
    <Field.Label>エージェントの名前</Field.Label>
    <Input name="agent-name" />
    <Field.Description>一覧と会話の見出しに表示されます</Field.Description>
  </Field.Root>
</Story>

<Story
  name="Form"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A form in one column. Submit it empty: the error appears under the field, the field turns invalid, and the message is announced. Typing a name clears it.',
      },
    },
  }}
>
  <form class="flex w-80 flex-col gap-6" novalidate onsubmit={submit} aria-labelledby="form-title">
    <h2 id="form-title" class="type-lg">エージェントを作成</h2>
    <Field.Group>
      <Field.Root invalid={nameError !== undefined}>
        <Field.Label>名前 <span aria-hidden="true">*</span></Field.Label>
        <Input name="name" required bind:value={agentName} />
        <Field.Error message={nameError} />
      </Field.Root>
      <Field.Root>
        <Field.Label>説明</Field.Label>
        <Textarea name="description" />
        <Field.Description>任意。ほかのエージェントにも見えます。</Field.Description>
      </Field.Root>
    </Field.Group>
    <div class="flex justify-end gap-2">
      <Button type="reset" variant="secondary">リセット</Button>
      <Button type="submit">作成</Button>
    </div>
  </form>
</Story>

<Story
  name="Horizontal"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A checkbox or switch first, then its label and description, in a row at least 44px high.',
      },
    },
  }}
>
  <Field.Group class="w-80 gap-2">
    <Field.Root orientation="horizontal">
      <Checkbox name="terms" />
      <Field.Content>
        <Field.Label>利用規約に同意する</Field.Label>
        <Field.Description>同意すると、アカウントを作成できます</Field.Description>
      </Field.Content>
    </Field.Root>
    <Field.Root orientation="horizontal">
      <Field.Content>
        <Field.Label>デバイス間で同期</Field.Label>
        <Field.Description>ほかのデバイスでも同じ設定を使います</Field.Description>
      </Field.Content>
      <Switch name="sync" checked />
    </Field.Root>
  </Field.Group>
</Story>

<Story
  name="Fieldset"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Related choices in a native fieldset, named by its legend: here a radio group, each option with its own label.',
      },
    },
  }}
>
  <Field.Set class="w-80">
    <Field.Legend id="plan-legend">プラン</Field.Legend>
    <RadioGroup.Root bind:value={plan} name="plan" aria-labelledby="plan-legend" class="gap-1">
      {#each [{ value: 'free', label: '無料', note: 'エージェント 1 体まで' }, { value: 'pro', label: 'プロ', note: 'エージェント 10 体まで' }, { value: 'team', label: 'チーム', note: 'メンバーと共有できます' }] as option (option.value)}
        <Field.Root orientation="horizontal">
          <RadioGroup.Item value={option.value} />
          <Field.Content>
            <Field.Label>{option.label}</Field.Label>
            <Field.Description>{option.note}</Field.Description>
          </Field.Content>
        </Field.Root>
      {/each}
    </RadioGroup.Root>
  </Field.Set>
</Story>
