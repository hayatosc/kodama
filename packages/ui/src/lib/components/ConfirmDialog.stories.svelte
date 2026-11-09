<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import { Button } from './ui/button/index.js'
  import ConfirmDialog from './ConfirmDialog.svelte'

  const { Story } = defineMeta({
    title: 'Primitives/Dialog',
    component: ConfirmDialog,
    tags: ['autodocs'],
    args: {
      title: 'research をアーカイブしますか？',
      description:
        '会話と記憶は残り、あとから元に戻せます。アーカイブ中はメッセージを受け取らず、アラームも止まります。',
      confirmLabel: 'アーカイブ',
      destructive: true,
      onconfirm: fn(),
      oncancel: fn(),
    },
    parameters: {
      docs: {
        description: {
          component:
            'A confirmation before an action that is hard to undo. The title asks a question, the explanation says what is lost, what remains, and whether it can be undone, and the confirm button is a verb. Focus starts on cancel; Esc and a click on the scrim cancel. Source: `design/components/Dialog`.',
        },
      },
    },
  })
</script>

<script lang="ts">
  let open = $state(false)
  let result = $state('')
</script>

<Story name="Archive" asChild>
  <div class="flex flex-col items-start gap-3">
    <Button variant="destructive" onclick={() => (open = true)}>アーカイブ</Button>
    <ConfirmDialog
      bind:open
      title="research をアーカイブしますか？"
      description="会話と記憶は残り、あとから元に戻せます。アーカイブ中はメッセージを受け取らず、アラームも止まります。"
      confirmLabel="アーカイブ"
      destructive
      onconfirm={() => (result = 'アーカイブしました')}
      oncancel={() => (result = 'キャンセルしました')}
    />
    <p class="text-sm text-muted-foreground" aria-live="polite">{result}</p>
  </div>
</Story>

<Story
  name="Open"
  args={{ open: true }}
  tags={['!autodocs']}
  parameters={{
    docs: {
      description: { story: 'The dialog already open, for checking its layout in both themes.' },
    },
  }}
/>

<Story
  name="Rollback (not destructive)"
  args={{
    open: true,
    title: 'v12 にロールバックしますか？',
    description: '現在の設定 v14 は履歴に残り、いつでも戻せます。実行中の run は止まりません。',
    confirmLabel: 'ロールバック',
    destructive: false,
  }}
  tags={['!autodocs']}
/>
