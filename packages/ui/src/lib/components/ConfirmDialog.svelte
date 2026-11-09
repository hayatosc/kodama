<script lang="ts">
  import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js'

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    cancelLabel = 'キャンセル',
    destructive = false,
    onconfirm,
    oncancel,
  }: {
    open?: boolean
    /** A question: 「〜しますか？」 */
    title: string
    /** What is lost, what remains, and whether it can be undone. */
    description: string
    /** A verb: アーカイブ, 削除, ロールバック. */
    confirmLabel: string
    cancelLabel?: string
    /** Fills the confirm button with `destructive`. */
    destructive?: boolean
    onconfirm: () => void
    oncancel?: () => void
  } = $props()

  let cancelButton = $state<HTMLButtonElement | null>(null)

  /** bits-ui's Action does not close the dialog, so confirming closes it here. */
  function confirm(): void {
    open = false
    onconfirm()
  }

  /**
   * Esc, a click on the scrim, and the cancel button close without confirming. bits-ui calls this
   * only for those, not when `open` is set from outside (as `confirm` does).
   */
  function onOpenChange(next: boolean): void {
    if (!next) oncancel?.()
  }

  /** Focus starts on cancel, so Enter right after opening never confirms by accident. */
  function focusCancel(event: Event): void {
    event.preventDefault()
    cancelButton?.focus()
  }
</script>

<!-- role="alertdialog" (design/components/Dialog). -->
<AlertDialog.Root bind:open {onOpenChange}>
  <AlertDialog.Content interactOutsideBehavior="close" onOpenAutoFocus={focusCancel}>
    <AlertDialog.Title>{title}</AlertDialog.Title>
    <AlertDialog.Description>{description}</AlertDialog.Description>
    <AlertDialog.Footer>
      <AlertDialog.Cancel bind:ref={cancelButton}>{cancelLabel}</AlertDialog.Cancel>
      <AlertDialog.Action {destructive} onclick={confirm}>{confirmLabel}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
