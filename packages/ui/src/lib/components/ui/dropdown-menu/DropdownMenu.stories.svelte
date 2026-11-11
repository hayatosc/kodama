<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf'
  import { fn } from 'storybook/test'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import CopyIcon from '@lucide/svelte/icons/copy'
  import EllipsisIcon from '@lucide/svelte/icons/ellipsis'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import Share2Icon from '@lucide/svelte/icons/share-2'
  import TrashIcon from '@lucide/svelte/icons/trash'
  import DropdownMenuContent from './dropdown-menu-content.svelte'
  import * as DropdownMenu from './index.js'

  const { Story } = defineMeta({
    title: 'Primitives/DropdownMenu',
    component: DropdownMenuContent,
    tags: ['autodocs'],
    parameters: {
      docs: {
        description: {
          component:
            'A popup menu of commands. The trigger toggles it with an invoker command (`commandfor`, `command="toggle-popover"`), and the menu is a native focusgroup: one Tab stop, ↑ ↓ between items, Home and End to either end, Esc back to the trigger, and Tab out closes it. Enter, Space, or ↓ on the trigger opens it and focuses the first item; a click opens it with focus left on the trigger. A command closes the menu and returns focus to the trigger. A checkbox item stays open on Space and closes on Enter; a radio item closes on either, a moment after the check mark moves. Where focusgroup is missing, the same keys come from script with `role="menu"` and `role="menuitem"`.',
        },
      },
    },
  })

  const edit = fn()
  const duplicate = fn()
  const share = fn()
  const remove = fn()
</script>

<script lang="ts">
  let showHidden = $state(false)
  let showPreview = $state(true)
  let sort = $state('updated')
</script>

<Story name="Default" asChild>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>開く</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Item>項目 1</DropdownMenu.Item>
      <DropdownMenu.Item>項目 2</DropdownMenu.Item>
      <DropdownMenu.Item>項目 3</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</Story>

<Story name="With icons and shortcuts" asChild>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      操作
      <ChevronDownIcon strokeWidth={1.75} aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Item onclick={edit} aria-keyshortcuts="Control+E">
        <PencilIcon strokeWidth={1.75} aria-hidden="true" />
        編集
        <DropdownMenu.Shortcut>Ctrl E</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
      <DropdownMenu.Item onclick={duplicate} aria-keyshortcuts="Control+D">
        <CopyIcon strokeWidth={1.75} aria-hidden="true" />
        複製
        <DropdownMenu.Shortcut>Ctrl D</DropdownMenu.Shortcut>
      </DropdownMenu.Item>
      <DropdownMenu.Item onclick={share}>
        <Share2Icon strokeWidth={1.75} aria-hidden="true" />
        共有
      </DropdownMenu.Item>
      <DropdownMenu.Item disabled>名前を変更</DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item variant="destructive" onclick={remove}>
        <TrashIcon strokeWidth={1.75} aria-hidden="true" />
        削除
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</Story>

<Story
  name="Checkable items"
  asChild
  parameters={{
    docs: {
      description: {
        story:
          'Checkbox items (`menuitemcheckbox`) and a radio group (`menuitemradio` in a named group). The check mark is drawn from `aria-checked`, so what is seen and what is announced always agree.',
      },
    },
  }}
>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>表示</DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Group label="表示">
        <DropdownMenu.CheckboxItem bind:checked={showHidden}>
          非表示のファイル
        </DropdownMenu.CheckboxItem>
        <DropdownMenu.CheckboxItem bind:checked={showPreview}>プレビュー</DropdownMenu.CheckboxItem>
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
      <DropdownMenu.RadioGroup label="並び順" bind:value={sort}>
        <DropdownMenu.RadioItem value="updated">更新日</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="name">名前</DropdownMenu.RadioItem>
        <DropdownMenu.RadioItem value="size">サイズ</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</Story>

<Story name="Icon trigger" asChild>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger variant="ghost" size="icon" aria-label="その他の操作">
      <EllipsisIcon strokeWidth={1.75} aria-hidden="true" />
    </DropdownMenu.Trigger>
    <DropdownMenu.Content>
      <DropdownMenu.Item onclick={edit}>編集</DropdownMenu.Item>
      <DropdownMenu.Item onclick={duplicate}>複製</DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item variant="destructive" onclick={remove}>削除</DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</Story>
