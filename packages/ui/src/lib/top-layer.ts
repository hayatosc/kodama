/**
 * Helpers for native top-layer elements (`<dialog>` and `[popover]`): closing a dialog after its
 * exit transition, and click-outside closing where `<dialog closedby>` is missing. Both features
 * are not Baseline yet (`overlay` and `closedby`), so these are the fallbacks the platform needs.
 *
 * @module
 */

let displayTransition: boolean | undefined

/**
 * Whether `display` really transitions. Firefox parses `transition-behavior: allow-discrete` but
 * hides the element at once, so a `CSS.supports` check alone is not enough.
 */
function canTransitionDisplay(): boolean {
  if (displayTransition !== undefined) return displayTransition
  if (!CSS.supports('transition-behavior', 'allow-discrete')) {
    displayTransition = false
    return displayTransition
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;'
  document.body.append(probe)
  const before = getComputedStyle(probe).display
  probe.style.display = 'none'
  displayTransition = before === 'block' && getComputedStyle(probe).display === 'block'
  probe.remove()
  return displayTransition
}

/** Whether the browser keeps a closing element in the top layer while its transition runs. */
export function supportsTopLayerExit(): boolean {
  return CSS.supports('overlay', 'auto') && canTransitionDisplay()
}

/**
 * Closes a dialog with its exit transition. Where the top layer cannot hold the element during
 * the transition, `data-closing` plays it while the dialog is still open, and the dialog closes
 * once its animations settle (at most two seconds later).
 */
export async function closeDialog(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return
  if (!supportsTopLayerExit()) {
    dialog.setAttribute('data-closing', '')
    const animations = dialog.getAnimations({ subtree: true })
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ])
    }
    // Reopened while the exit was running.
    if (!dialog.hasAttribute('data-closing')) return
    dialog.removeAttribute('data-closing')
  }
  dialog.close()
}

/** Whether a pointer event landed outside the dialog's box, on its backdrop. */
function outside(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const box = dialog.getBoundingClientRect()
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
}

/**
 * Closes a modal dialog when a press both starts and ends on its backdrop, for browsers without
 * `closedby="any"`. Requiring both ends keeps a text selection that ends outside from closing it.
 *
 * @returns A function that removes the listeners, or nothing where `closedby` is supported.
 */
export function closeOnBackdrop(
  dialog: HTMLDialogElement,
  close: () => void,
): (() => void) | undefined {
  if ('closedBy' in HTMLDialogElement.prototype) return undefined
  let pressedOutside = false
  const down = (event: PointerEvent): void => {
    pressedOutside = outside(event, dialog)
  }
  const up = (event: PointerEvent): void => {
    if (pressedOutside && outside(event, dialog)) close()
  }
  dialog.addEventListener('pointerdown', down)
  dialog.addEventListener('pointerup', up)
  return () => {
    dialog.removeEventListener('pointerdown', down)
    dialog.removeEventListener('pointerup', up)
  }
}
