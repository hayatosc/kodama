<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import AlertDialogContent from './AlertDialogContent.svelte'
  import * as AlertDialog from './index.js'

  const { Story } = defineMeta({
    title: 'Patterns/AlertDialog',
    component: AlertDialogContent,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A Dialog that asks before an action that is hard to undo, exposed as `role="alertdialog"`. The title asks a question, the description says what is lost, what remains, and whether it can be undone, and **Action** is a verb. **Cancel** comes first, so the browser focuses it on open and Enter right after opening never confirms. **Action** runs its `onclick` and then closes the dialog, unless the handler calls `preventDefault()`. Esc and a click on the backdrop cancel. Source: `design/components/Dialog`.',
        },
      },
    },
  })

  const logOut = fn()
  const deleteFile = fn()
</script>

<Story name="Default" asChild>
  <AlertDialog.Root>
    <AlertDialog.Trigger>ログアウト</AlertDialog.Trigger>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>ログアウトしますか？</AlertDialog.Title>
        <AlertDialog.Description>
          保存していない変更は失われます。もう一度ログインすれば、続きから作業できます。
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
        <AlertDialog.Action onclick={logOut}>ログアウト</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</Story>

<Story
  name="Destructive"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'An action that deletes. The trigger is a destructive button, and the confirm is filled with the destructive color.',
      },
    },
  }}
>
  <AlertDialog.Root>
    <AlertDialog.Trigger variant="destructive">ファイルを削除</AlertDialog.Trigger>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>report.pdf を削除しますか？</AlertDialog.Title>
        <AlertDialog.Description>
          ファイルは完全に削除され、元に戻せません。共有リンクも使えなくなります。
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
        <AlertDialog.Action variant="destructive" onclick={deleteFile}>削除</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
</Story>
