<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { Button } from '../button/index.js'
  import * as KeyboardKey from '../keyboard-key/index.js'
  import { Switch } from '../switch/index.js'
  import DialogContent from './dialog-content.svelte'
  import * as Dialog from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/Dialog',
    component: DialogContent,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A window over the page that the user deals with before going back to it, built on the native modal `<dialog>`. The browser makes the page behind it inert, keeps focus inside, and returns focus to the trigger on close. **Trigger** and **Close** use invoker commands (`command="show-modal"`, `command="close"`), and `bind:open` opens and closes it from code. It closes on Esc and on a click on the backdrop; set `closedby="closerequest"` for Esc only, or `"none"` for its buttons only. **Title** names it and **Description** describes it. To confirm an action, use AlertDialog. Source: `design/components/Dialog`.',
        },
      },
    },
  })

  const shortcuts = [
    { keys: ['⌘', 'K'], label: 'コマンドパレットを開く' },
    { keys: ['⌘', 'S'], label: '保存' },
    { keys: ['⌘', 'Z'], label: '元に戻す' },
    { keys: ['Esc'], label: 'ダイアログを閉じる' },
  ]

  const terms = [
    'このサービスは、登録したアカウントごとに提供します。アカウントの情報は正確に保ち、変わったときは速やかに更新してください。',
    'パスワードは本人が管理します。第三者に知られたと思われるときは、すぐに変更してください。',
    '保存したデータは、本人が削除するまで保管します。アカウントを削除すると、30 日後にすべてのデータを消去します。',
    '法令に反する目的や、ほかの利用者の迷惑になる目的では利用できません。',
    '提供内容は予告なく変更することがあります。重要な変更は、事前にメールでお知らせします。',
    '障害やメンテナンスのため、一時的に利用できないことがあります。',
    'この規約に定めのないことは、関係する法令に従います。',
  ]
</script>

<script lang="ts">
  let notifyOpen = $state(false)
  let notifyByMail = $state(true)
  let notifyWeekly = $state(false)
</script>

<Story name="Default" asChild>
  <Dialog.Root>
    <Dialog.Trigger>ショートカットを表示</Dialog.Trigger>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>キーボードショートカット</Dialog.Title>
        <Dialog.Description>よく使う操作は、キーボードからも行えます。</Dialog.Description>
      </Dialog.Header>
      <dl class="flex flex-col gap-2 text-sm">
        {#each shortcuts as shortcut (shortcut.label)}
          <div class="flex items-center justify-between gap-4">
            <dt>{shortcut.label}</dt>
            <dd>
              <KeyboardKey.Group>
                {#each shortcut.keys as key (key)}<KeyboardKey.Root>{key}</KeyboardKey.Root>{/each}
              </KeyboardKey.Group>
            </dd>
          </div>
        {/each}
      </dl>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story
  name="With actions"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'A small form with its actions in the footer: cancel first, then the primary action. The browser focuses the first control on open. `bind:open` lets 保存 close the dialog after saving.',
      },
    },
  }}
>
  <Dialog.Root bind:open={notifyOpen}>
    <Dialog.Trigger>通知を設定</Dialog.Trigger>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>通知の設定</Dialog.Title>
        <Dialog.Description>どの方法で知らせるかを選びます。</Dialog.Description>
      </Dialog.Header>
      <div class="flex flex-col">
        <label class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
          メールで知らせる
          <Switch bind:checked={notifyByMail} />
        </label>
        <label class="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
          週次レポートを受け取る
          <Switch bind:checked={notifyWeekly} />
        </label>
      </div>
      <Dialog.Footer>
        <Dialog.Close>キャンセル</Dialog.Close>
        <Button onclick={() => (notifyOpen = false)}>保存</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story
  name="Without the close button"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          '`showCloseButton={false}` removes the × at the top right. Keep a visible way out, such as a Close in the footer.',
      },
    },
  }}
>
  <Dialog.Root>
    <Dialog.Trigger>お知らせを開く</Dialog.Trigger>
    <Dialog.Content showCloseButton={false}>
      <Dialog.Header>
        <Dialog.Title>新しい機能</Dialog.Title>
        <Dialog.Description>
          検索結果を保存して、あとから同じ条件で開けるようになりました。
        </Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Dialog.Close variant="primary">わかりました</Dialog.Close>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>

<Story
  name="Scrollable content"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Content taller than the viewport scrolls inside the dialog, and scrolling never moves the page behind it.',
      },
    },
  }}
>
  <Dialog.Root>
    <Dialog.Trigger>利用規約を読む</Dialog.Trigger>
    <Dialog.Content class="w-[480px]">
      <Dialog.Header>
        <Dialog.Title>利用規約</Dialog.Title>
        <Dialog.Description>2026 年 11 月 1 日改定</Dialog.Description>
      </Dialog.Header>
      <ol class="flex list-decimal flex-col gap-3 pl-5 text-sm leading-6">
        {#each [...terms, ...terms] as term, index (index)}
          <li>{term}</li>
        {/each}
      </ol>
      <Dialog.Footer>
        <Dialog.Close variant="primary">同意して閉じる</Dialog.Close>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</Story>
