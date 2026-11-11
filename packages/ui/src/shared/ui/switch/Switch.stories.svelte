<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import { Switch } from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Switch',
    component: Switch,
    tags: ['autodocs'],
    args: { checked: false, disabled: false, onchange: fn() },
    argTypes: {
      checked: { control: 'boolean' },
      disabled: { control: 'boolean' },
    },
    parameters: {
      docs: {
        description: {
          component:
            'An on/off setting that takes effect the moment it changes; a setting saved with a button uses a checkbox instead. It is a native checkbox with the `switch` attribute and `role="switch"`, so it submits with forms, toggles with Space, and reads as a switch. Give it a `<label>`: wrapping the switch and its text in a 44px-high label makes the whole row the target. On is inverted (the primary color). Source: `design/components/Switch`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let settings = $state([
    { id: 'notify-push', label: 'プッシュ通知', checked: true },
    { id: 'notify-mail', label: 'メール通知', checked: false },
    { id: 'notify-weekly', label: '週次レポート', checked: true },
  ])
</script>

<Story name="Default">
  {#snippet template(args)}
    <label class="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <Switch {...args} />
      機内モード
    </label>
  {/snippet}
</Story>

<Story
  name="With description"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A second line explains the setting. `aria-describedby` links it, so screen readers read it after the name.',
      },
    },
  }}
>
  <div class="flex w-80 items-start justify-between gap-4">
    <div class="flex flex-col gap-0.5">
      <label for="switch-sync" class="cursor-pointer text-sm font-semibold">デバイス間で同期</label>
      <p id="switch-sync-description" class="text-xs text-muted-foreground">
        ほかのデバイスでも同じ設定を使います。オフにすると、このデバイスだけに保存します。
      </p>
    </div>
    <Switch id="switch-sync" aria-describedby="switch-sync-description" checked />
  </div>
</Story>

<Story name="Disabled">
  {#snippet template(args)}
    <label class="flex min-h-11 items-center gap-3 text-sm">
      <Switch {...args} checked disabled />
      管理者が固定した設定
    </label>
  {/snippet}
</Story>

<Story
  name="In a list"
  asChild
  parameters={{
    docs: {
      description: {
        story: 'Several settings, one per row, with the switch at the right of each 44px row.',
      },
    },
  }}
>
  <fieldset class="flex w-72 flex-col">
    <legend class="mb-1 text-xs text-muted-foreground">通知</legend>
    {#each settings as setting (setting.id)}
      <label class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
        {setting.label}
        <Switch id={setting.id} bind:checked={setting.checked} />
      </label>
    {/each}
  </fieldset>
</Story>
