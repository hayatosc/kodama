<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import ArchiveIcon from '@lucide/svelte/icons/archive'
  import SettingsListRoot from './SettingsList.svelte'
  import * as SettingsList from './index.js'
  import { Combobox, type ComboboxOption } from '../combobox/index.js'
  import { Switch } from '../switch/index.js'

  const providers: ComboboxOption[] = [
    'Anthropic',
    'OpenAI',
    'Google',
    'xAI',
    'Mistral',
    'DeepSeek',
    'Groq',
    'OpenRouter',
    'Cloudflare Workers AI',
  ].map((value) => ({ value }))

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
    title: 'Patterns/SettingsList',
    component: SettingsListRoot,
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'A card of settings rows, for the right pane’s 「ルーティン」 and 「設定」 and for settings pages. Each row has a label, optionally a one-sentence hint under it, and one thing at the right edge. **Value** shows a read-only value, monospaced and muted. **Row** holds a control (a Switch, or a Combobox without an outline): its label names the control and its hint describes it. **Action** is a destructive action at the end of the card, which always asks first in an alert dialog. A `heading` above the card names it as a section. Source: `design/components/SettingsList`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let provider = $state('Anthropic')
  let model = $state('claude-sonnet-5-5')
  let contact = $state(true)
  let extraction = $state(false)
  let archived = $state(false)
</script>

<Story name="Default" asChild>
  <SettingsList.Root class="w-80 max-w-full">
    <SettingsList.Value label="毎朝のまとめ" value="09:00 毎日" />
    <SettingsList.Value label="次のアラーム" value="03:00" />
  </SettingsList.Root>
</Story>

<Story
  name="Settings"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Two cards under headings: choices with a searchable select, a read-only value, switches with hints, and an archive action that asks first.',
      },
    },
  }}
>
  <div class="flex w-80 max-w-full flex-col gap-4">
    <SettingsList.Root heading="設定">
      <SettingsList.Row label="プロバイダー">
        <Combobox label="プロバイダー" options={providers} variant="inline" bind:value={provider} />
      </SettingsList.Row>
      <SettingsList.Row label="モデル">
        <Combobox label="モデル" options={models} variant="inline" mono bind:value={model} />
      </SettingsList.Row>
      <SettingsList.Value label="次のアラーム" value="03:00" />
    </SettingsList.Root>
    <SettingsList.Root heading="動作">
      <SettingsList.Row label="外部への連絡" hint="他のエージェントへの依頼を許可する">
        <Switch bind:checked={contact} />
      </SettingsList.Row>
      <SettingsList.Row label="記憶の自動抽出" hint="会話から覚えることを毎晩まとめる">
        <Switch bind:checked={extraction} />
      </SettingsList.Row>
      <SettingsList.Action
        label="エージェントをアーカイブ"
        icon={ArchiveIcon}
        title="writer をアーカイブしますか？"
        description="会話と記憶は残りますが、アラームとルーティンは止まり、新しいメッセージを受け取らなくなります。あとで元に戻せます。"
        confirmLabel="アーカイブ"
        onconfirm={() => (archived = true)}
      />
    </SettingsList.Root>
    {#if archived}<p class="text-sm text-muted-foreground" role="status">アーカイブしました</p>{/if}
  </div>
</Story>
