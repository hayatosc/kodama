<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import { Button } from '../button/index.js'
  import * as Dialog from '../dialog/index.js'
  import { Toaster, toast } from './index.js'

  const { Story } = defineMeta({
    title: 'Patterns/Toast',
    component: Toaster,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A notification about the result of an action or an event, for information the user can afford to miss. `toast(title, options)` adds one, and the one `Toaster` on the page shows it in a region named 通知, in a manual popover that nothing closes but its own buttons. A toast stays until it is closed unless given a `duration`, which pauses while it has focus or the pointer. It is announced with `ariaNotify` (only its text, with a note when it has an action) and never takes focus; closing a focused toast moves focus to the next toast, or back to where it was. A toast raised while a modal dialog is open waits until the dialog closes. Anything urgent belongs in a Callout or a Dialog, and an action in a toast must also be available elsewhere.',
        },
      },
    },
  })

  const undo = fn()
</script>

<Story name="Default" asChild>
  <div>
    <Button variant="secondary" onclick={() => toast('通知のメッセージ')}>通知を表示</Button>
    <Toaster />
  </div>
</Story>

<Story name="Variants" asChild>
  <div class="flex flex-wrap gap-2">
    <Button variant="secondary" onclick={() => toast('設定を保存しました')}>通知</Button>
    <Button
      variant="secondary"
      onclick={() =>
        toast('アップロードが完了しました', {
          description: 'report.pdf を「資料」フォルダに追加しました。',
          variant: 'success',
        })}
    >
      成功
    </Button>
    <Button
      variant="secondary"
      onclick={() =>
        toast('送信できませんでした', {
          description: 'ネットワークに接続してから、もう一度お試しください。',
          variant: 'destructive',
        })}
    >
      エラー
    </Button>
    <Toaster />
  </div>
</Story>

<Story
  name="With action"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A shortcut to an action that is also on the page, here undoing an archive. The announcement ends with 操作があります.',
      },
    },
  }}
>
  <div>
    <Button
      variant="secondary"
      onclick={() =>
        toast('スレッドをアーカイブしました', {
          action: { label: '元に戻す', onclick: undo },
        })}
    >
      アーカイブ
    </Button>
    <Toaster />
  </div>
</Story>

<Story
  name="Auto dismiss"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'For frequent, low-importance events only: the toast closes after five seconds, but not while it has focus or the pointer.',
      },
    },
  }}
>
  <div>
    <Button variant="secondary" onclick={() => toast('コピーしました', { duration: 5000 })}>
      コピー
    </Button>
    <Toaster />
  </div>
</Story>

<Story
  name="Held during a dialog"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'The toast raised inside the dialog waits, and appears and is announced once the dialog closes.',
      },
    },
  }}
>
  <div>
    <Dialog.Root>
      <Dialog.Trigger>ダイアログを開く</Dialog.Trigger>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>下書きを保存</Dialog.Title>
          <Dialog.Description>保存すると、閉じたあとに通知が表示されます。</Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Dialog.Close>閉じる</Dialog.Close>
          <Button onclick={() => toast('下書きを保存しました', { variant: 'success' })}>
            保存
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
    <Toaster />
  </div>
</Story>
