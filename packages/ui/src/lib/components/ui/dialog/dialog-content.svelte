<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x'
  import { Button } from '#lib/components/ui/button/index.js'
  import { closeDialog, closeOnBackdrop, supportsTopLayerExit } from '#lib/top-layer.js'
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { getDialogState } from './context.js'
  import type { Attachment } from 'svelte/attachments'
  import type { HTMLDialogAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    class: className,
    closedby = 'any',
    showCloseButton = true,
    closeLabel = '閉じる',
    children,
    ...restProps
  }: WithElementRef<Omit<HTMLDialogAttributes, 'open' | 'id' | 'closedby'>, HTMLDialogElement> & {
    /**
     * How the dialog may close besides its buttons: `any` also closes on Esc and a click on the
     * backdrop (the default), `closerequest` on Esc only, `none` only from code or a button.
     */
    closedby?: 'any' | 'closerequest' | 'none'
    /** The × button at the top right. */
    showCloseButton?: boolean
    /** The × button's accessible name. */
    closeLabel?: string
  } = $props()

  const dialog = getDialogState()

  function close(): void {
    dialog.open = false
  }

  /** Opens the dialog as a modal, or closes it with its exit transition, when `open` changes. */
  const followOpen: Attachment<HTMLDialogElement> = (element) => {
    if (dialog.open && !element.open) element.showModal()
    else if (!dialog.open && element.open) closeDialog(element).catch(() => element.close())
  }

  /**
   * Keeps `open` in step with the browser: Trigger opens the dialog with an invoker command, and
   * Esc, the backdrop, and Close shut it. Where the top layer cannot hold a closing dialog, those
   * closes are held back and replayed through `followOpen`, so the exit transition still plays.
   * Where `closedby` is missing, Esc is held back for `none`, and the backdrop gets a listener.
   */
  const followBrowser: Attachment<HTMLDialogElement> = (element) => {
    const onCommand = (event: Event): void => {
      if (!('command' in event)) return
      if (event.command === 'show-modal') dialog.open = true
      if (event.command === 'close' && !supportsTopLayerExit()) {
        event.preventDefault()
        close()
      }
    }
    const onCancel = (event: Event): void => {
      if (closedby === 'none') {
        event.preventDefault()
        return
      }
      if (!supportsTopLayerExit()) {
        event.preventDefault()
        close()
      }
    }
    element.addEventListener('command', onCommand)
    element.addEventListener('cancel', onCancel)
    const stopBackdrop = closedby === 'any' ? closeOnBackdrop(element, close) : undefined
    return () => {
      element.removeEventListener('command', onCommand)
      element.removeEventListener('cancel', onCancel)
      stopBackdrop?.()
    }
  }
</script>

<!--
  A native modal <dialog> (dialog guide): the browser makes the page inert, traps and returns
  focus, puts the dialog in the top layer, and closes it on Esc. It is named by Title and
  described by Description. design/components/Dialog: 400px wide, 24px padding, rounded-xl,
  the large shadow; the scrim and the transitions are in src/lib/styles/native.css.
-->
<dialog
  bind:this={ref}
  id={dialog.id}
  {closedby}
  aria-labelledby={dialog.labelled ? `${dialog.id}-title` : undefined}
  aria-describedby={dialog.described ? `${dialog.id}-description` : undefined}
  data-slot="dialog-content"
  class={cn(
    'm-auto max-h-[calc(100%-2rem)] w-[400px] max-w-[calc(100%-2rem)] overflow-y-auto',
    'rounded-xl border border-border bg-popover p-6 text-foreground shadow-lg',
    'open:flex open:flex-col open:gap-6',
    showCloseButton && '[&>[data-slot=dialog-header]]:pr-8',
    className,
  )}
  onclose={close}
  {@attach followOpen}
  {@attach followBrowser}
  {...restProps}
>
  {@render children?.()}
  {#if showCloseButton}
    <Button
      variant="ghost"
      size="icon-sm"
      command="close"
      commandfor={dialog.id}
      aria-label={closeLabel}
      class="absolute top-3 right-3"
    >
      <XIcon strokeWidth={1.75} aria-hidden="true" />
    </Button>
  {/if}
</dialog>
