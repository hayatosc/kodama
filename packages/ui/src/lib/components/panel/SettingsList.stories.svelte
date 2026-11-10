<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { models, providers } from '../../../stories/mock.js'
  import ConfirmDialog from '../ConfirmDialog.svelte'
  import Select from '../Select.svelte'
  import { Switch } from '../ui/switch/index.js'
  import SettingsAction from './SettingsAction.svelte'
  import SettingsList from './SettingsList.svelte'
  import SettingsRow from './SettingsRow.svelte'

  const { Story } = defineMeta({
    title: 'Kodama/SettingsList',
    component: SettingsList,
    tags: ['autodocs'],
    parameters: {
      layout: 'padded',
      docs: {
        description: {
          component:
            'A settings card of label and value rows under a small heading. The right edge holds one thing: a read-only value in mono, a borderless Select, or a Switch. A destructive action goes last in red and always opens a confirmation dialog. Source: `design/components/SettingsList`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let provider = $state('anthropic')
  let model = $state('claude-sonnet-5-5')
  let notify = $state(true)
  let confirming = $state(false)
</script>

<Story name="Agent settings" asChild>
  <div class="flex w-80 flex-col gap-4">
    <SettingsList title="ルーティン">
      <SettingsRow label="毎朝のまとめ" value="09:00 毎日" />
      <SettingsRow label="次のアラーム" value="03:00" />
    </SettingsList>
    <SettingsList title="設定">
      <SettingsRow label="プロバイダー">
        <Select options={providers} bind:value={provider} variant="inline" label="プロバイダー" />
      </SettingsRow>
      <SettingsRow label="モデル">
        <Select options={models} bind:value={model} variant="inline" mono label="モデル" />
      </SettingsRow>
      <SettingsRow label="返信を通知" hint="ほかのエージェントからの返事が届いたとき">
        <Switch bind:checked={notify} aria-label="返信を通知" />
      </SettingsRow>
      <SettingsAction
        label="エージェントをアーカイブ"
        hint="会話と記憶は残ります"
        onclick={() => (confirming = true)}
      />
    </SettingsList>
    <ConfirmDialog
      bind:open={confirming}
      title="assistant をアーカイブしますか？"
      description="会話と記憶は残り、あとから元に戻せます。アーカイブ中はメッセージを受け取らず、アラームも止まります。"
      confirmLabel="アーカイブ"
      destructive
      onconfirm={() => {}}
    />
  </div>
</Story>
