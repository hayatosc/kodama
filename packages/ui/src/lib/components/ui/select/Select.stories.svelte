<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import { regions } from '../../../../stories/prefectures.js'
  import * as Select from './index.js'
  import SelectRoot from './select.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Select',
    component: SelectRoot,
    tags: ['autodocs'],
    args: { size: 'default', disabled: false, onchange: fn() },
    argTypes: {
      size: { control: 'inline-radio', options: ['default', 'sm'] },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'Picks one option from a short list, built on the native `<select>`. Where the browser supports the customizable select (`appearance: base-select`), the menu is styled like the rest of the UI: the current value has a check, a background, and a heavier weight, and the menu fades in. Elsewhere the same trigger opens the system menu. The browser handles the keyboard (type to jump, arrows, Enter, Esc) and form submission. Give it a `<label>`. **Item** is an `<option>`, **Group** an `<optgroup>`, **Separator** an `<hr>`. To search a long list, use the Combobox instead. Source: `design/components/Select`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let theme = $state('system')
  let food = $state('banana')
  let prefecture = $state('東京都')
  let plan = $state('')
  let language = $state('ja')
  let country = $state('')
</script>

<Story name="Default">
  {#snippet template(args)}
    <div class="flex flex-col gap-1.5">
      <label for="select-theme" class="text-sm font-semibold">テーマ</label>
      <Select.Root id="select-theme" name="theme" bind:value={theme} {...args}>
        <Select.Item value="light">ライト</Select.Item>
        <Select.Item value="dark">ダーク</Select.Item>
        <Select.Item value="system">システムに合わせる</Select.Item>
      </Select.Root>
    </div>
  {/snippet}
</Story>

<Story
  name="Groups"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Groups with a muted heading, and a separator between them.',
      },
    },
  }}
>
  <div class="flex flex-col gap-1.5">
    <label for="select-food" class="text-sm font-semibold">食材</label>
    <Select.Root id="select-food" name="food" bind:value={food}>
      <Select.Group label="果物">
        <Select.Item value="apple">りんご</Select.Item>
        <Select.Item value="banana">バナナ</Select.Item>
        <Select.Item value="grape">ぶどう</Select.Item>
      </Select.Group>
      <Select.Separator />
      <Select.Group label="野菜">
        <Select.Item value="carrot">にんじん</Select.Item>
        <Select.Item value="broccoli">ブロッコリー</Select.Item>
        <Select.Item value="spinach">ほうれん草</Select.Item>
      </Select.Group>
    </Select.Root>
  </div>
</Story>

<Story
  name="Scrollable"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A long list scrolls inside the menu, at most 260px high. Typing the first characters jumps to an option; for a real search field, use the Combobox.',
      },
    },
  }}
>
  <div class="flex flex-col gap-1.5">
    <label for="select-prefecture" class="text-sm font-semibold">都道府県</label>
    <Select.Root id="select-prefecture" name="prefecture" bind:value={prefecture}>
      {#each regions as region (region.name)}
        <Select.Group label={region.name}>
          {#each region.prefectures as name (name)}
            <Select.Item value={name}>{name}</Select.Item>
          {/each}
        </Select.Group>
      {/each}
    </Select.Root>
  </div>
</Story>

<Story
  name="Placeholder"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Nothing chosen yet: a first option with an empty value, disabled so it cannot be chosen again. With `required`, the form will not submit until a real option is chosen.',
      },
    },
  }}
>
  <div class="flex flex-col gap-1.5">
    <label for="select-plan" class="text-sm font-semibold">プラン</label>
    <Select.Root id="select-plan" name="plan" required bind:value={plan}>
      <Select.Item value="" disabled>選択してください</Select.Item>
      <Select.Item value="free">無料</Select.Item>
      <Select.Item value="pro">プロ</Select.Item>
      <Select.Item value="team">チーム</Select.Item>
    </Select.Root>
  </div>
</Story>

<Story
  name="Disabled"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'The whole select disabled, then a single option disabled.',
      },
    },
  }}
>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <label for="select-locked" class="text-sm font-semibold">リージョン</label>
      <Select.Root id="select-locked" name="region" value="tokyo" disabled>
        <Select.Item value="tokyo">東京</Select.Item>
        <Select.Item value="osaka">大阪</Select.Item>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-1.5">
      <label for="select-size" class="text-sm font-semibold">サイズ</label>
      <Select.Root id="select-size" name="size" value="m">
        <Select.Item value="s">S</Select.Item>
        <Select.Item value="m">M</Select.Item>
        <Select.Item value="l" disabled>L（在庫なし）</Select.Item>
      </Select.Root>
    </div>
  </div>
</Story>

<Story
  name="Small"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '`size="sm"`: the 28px trigger at the right edge of a settings row, sized to its value.',
      },
    },
  }}
>
  <div class="flex w-80 items-center justify-between gap-3 text-sm">
    <label for="select-language">言語</label>
    <Select.Root id="select-language" name="language" size="sm" bind:value={language}>
      <Select.Item value="ja">日本語</Select.Item>
      <Select.Item value="en">English</Select.Item>
    </Select.Root>
  </div>
</Story>

<Story
  name="Invalid"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '`aria-invalid` turns the border destructive, and `aria-describedby` links the message, so it is read with the field.',
      },
    },
  }}
>
  <div class="flex flex-col gap-1.5">
    <label for="select-country" class="text-sm font-semibold">国または地域</label>
    <Select.Root
      id="select-country"
      name="country"
      required
      aria-invalid="true"
      aria-describedby="select-country-error"
      bind:value={country}
    >
      <Select.Item value="" disabled>選択してください</Select.Item>
      <Select.Item value="jp">日本</Select.Item>
      <Select.Item value="us">アメリカ合衆国</Select.Item>
    </Select.Root>
    <p id="select-country-error" class="text-xs text-destructive">国または地域を選んでください。</p>
  </div>
</Story>
