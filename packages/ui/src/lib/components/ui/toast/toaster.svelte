<script lang="ts">
  import CircleAlertIcon from '@lucide/svelte/icons/circle-alert'
  import CircleCheckIcon from '@lucide/svelte/icons/circle-check'
  import XIcon from '@lucide/svelte/icons/x'
  import { tick } from 'svelte'
  import { Button } from '#lib/components/ui/button/index.js'
  import { cn, type WithElementRef } from '#lib/utils.js'
  import { dismissToast, listToasts, releaseHeldToasts, type Toast } from './state.svelte.js'
  import type { Attachment } from 'svelte/attachments'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    ref = $bindable(null),
    label = '通知',
    closeLabel = '通知を閉じる',
    class: className,
    ...restProps
  }: WithElementRef<Omit<HTMLAttributes<HTMLElement>, 'popover' | 'children'>> & {
    /** The region's name, by which screen reader users find it. */
    label?: string
    /** Each close button's accessible name. */
    closeLabel?: string
  } = $props()

  const shown = $derived(listToasts().filter((item) => !item.held))

  /** Shows the region while it holds a toast, and releases held toasts when a modal closes. */
  const followToasts: Attachment<HTMLElement> = (element) => {
    const open = element.matches(':popover-open')
    if (shown.length > 0 && !open) element.showPopover()
    if (shown.length === 0 && open) element.hidePopover()
  }

  const releaseOnDialogClose: Attachment<HTMLElement> = () => {
    // `close` does not bubble, so listen in the capture phase.
    const onClose = (event: Event): void => {
      if (event.target instanceof HTMLDialogElement) releaseHeldToasts()
    }
    document.addEventListener('close', onClose, true)
    return () => document.removeEventListener('close', onClose, true)
  }

  /**
   * Dismisses a toast itself after its duration, paused while it has focus or the pointer, so
   * nobody loses a toast they are reading or about to operate.
   */
  function autoDismiss(item: Toast): Attachment<HTMLLIElement> {
    return (element) => {
      const duration = item.duration
      if (duration === undefined) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const start = (): void => {
        clearTimeout(timer)
        if (element.matches(':focus-within, :hover')) return
        timer = setTimeout(() => dismissToast(item.id), duration)
      }
      const pause = (): void => clearTimeout(timer)
      start()
      element.addEventListener('focusin', pause)
      element.addEventListener('pointerenter', pause)
      element.addEventListener('focusout', start)
      element.addEventListener('pointerleave', start)
      return () => {
        clearTimeout(timer)
        element.removeEventListener('focusin', pause)
        element.removeEventListener('pointerenter', pause)
        element.removeEventListener('focusout', start)
        element.removeEventListener('pointerleave', start)
      }
    }
  }

  /**
   * Closes a toast. If it had focus, focus moves to the next toast (or the previous one), and
   * after the last toast back to where it was when the toast appeared.
   */
  async function close(item: Toast, element: HTMLElement | null): Promise<void> {
    const hadFocus = element?.contains(document.activeElement) ?? false
    const others = shown.filter((other) => other.id !== item.id && !other.closing)
    const index = shown.indexOf(item)
    const next = others.find((other) => shown.indexOf(other) > index) ?? others.at(-1)
    dismissToast(item.id)
    if (!hadFocus) return
    await tick()
    const target = next
      ? document.querySelector<HTMLElement>(`#${next.id} [data-slot='toast-close']`)
      : item.origin
    if (target instanceof HTMLElement && target.isConnected) target.focus()
  }

  function act(item: Toast, element: HTMLElement | null): void {
    item.action?.onclick()
    close(item, element).catch(() => undefined)
  }
</script>

<!--
  The one place toasts appear: a named region (persistent-toast-notifications) in a manual
  popover, so it sits in the top layer and nothing closes it but its own buttons. Toasts are
  announced with ariaNotify when they appear and never take focus; Tab reaches their buttons.
-->
<section
  bind:this={ref}
  popover="manual"
  aria-label={label}
  data-slot="toaster"
  class={cn(
    'inset-auto end-0 bottom-0 m-0 max-h-dvh w-full overflow-y-auto border-0 bg-transparent p-4',
    'sm:w-[392px]',
    className,
  )}
  {@attach followToasts}
  {@attach releaseOnDialogClose}
  {...restProps}
>
  <ol class="flex flex-col gap-2">
    {#each shown as item (item.id)}
      <li
        id={item.id}
        data-slot="toast"
        data-variant={item.variant}
        inert={item.closing}
        class={cn(
          'flex items-start gap-3 rounded-xl border border-border bg-popover p-4 text-foreground shadow-lg',
          'transition-opacity duration-150 ease-out starting:opacity-0',
          'motion-safe:transition-[opacity,translate] motion-safe:starting:translate-y-2',
          item.closing && 'opacity-0 motion-safe:translate-x-4',
        )}
        {@attach autoDismiss(item)}
      >
        {#if item.variant === 'success'}
          <CircleCheckIcon class="mt-0.5 size-4 shrink-0 text-live" aria-hidden="true" />
        {:else if item.variant === 'destructive'}
          <CircleAlertIcon class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        {/if}
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <p class="text-sm font-semibold">{item.title}</p>
          {#if item.description}
            <p class="text-sm text-muted-foreground">{item.description}</p>
          {/if}
          {#if item.action}
            <Button
              variant="secondary"
              size="sm"
              class="mt-2 self-start"
              onclick={(event) => act(item, event.currentTarget.closest('li'))}
            >
              {item.action.label}
            </Button>
          {/if}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          data-slot="toast-close"
          aria-label={closeLabel}
          class="-mt-1 -me-1"
          onclick={(event) => {
            close(item, event.currentTarget.closest('li')).catch(() => undefined)
          }}
        >
          <XIcon strokeWidth={1.75} aria-hidden="true" />
        </Button>
      </li>
    {/each}
  </ol>
</section>
