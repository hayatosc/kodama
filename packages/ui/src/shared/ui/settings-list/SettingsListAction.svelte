<script lang="ts">
  import TrashIcon from '@lucide/svelte/icons/trash-2'
  import { cn } from '#shared/lib/utils.js'
  import * as AlertDialog from '../alert-dialog/index.js'
  import { settingsRow } from './row.js'
  import type { Component } from 'svelte'

  let {
    label,
    icon: Icon = TrashIcon,
    title,
    description,
    confirmLabel,
    onconfirm,
    class: className,
  }: {
    /** What the row does, such as 「エージェントをアーカイブ」. */
    label: string
    /** At the right edge; a trash can by default. */
    icon?: Component
    /** The confirmation's question, such as 「writer をアーカイブしますか？」. */
    title: string
    /** What happens, and whether it can be undone. */
    description: string
    /** The confirming button's label, such as 「アーカイブ」. */
    confirmLabel: string
    onconfirm: () => void
    class?: string
  } = $props()
</script>

<!--
  A destructive action, at the end of the card: destructive text with an icon at the right edge.
  It never acts at once; it asks first in an alert dialog, whose destructive button confirms.
-->
<AlertDialog.Root>
  <AlertDialog.Trigger
    variant="ghost"
    data-slot="settings-row"
    class={cn(
      settingsRow,
      'h-auto w-full rounded-none border-x-0 border-b-0 font-normal text-destructive hover:bg-destructive-soft',
      className,
    )}
  >
    {label}
    <Icon class="me-2 size-4" strokeWidth={1.75} aria-hidden="true" />
  </AlertDialog.Trigger>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{description}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>キャンセル</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={onconfirm}
        >{confirmLabel}</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
