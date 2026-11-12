/**
 * The toasts on screen, shared by `toast()` and the Toaster that shows them. Toasts stay until
 * dismissed unless given a duration (persistent-toast-notifications).
 *
 * @module
 */

/** A toast's look: `success` and `destructive` add an icon in that color. */
export type ToastVariant = 'neutral' | 'success' | 'destructive'

/** A shortcut to an action that is also available elsewhere on the page. */
export type ToastAction = {
  label: string
  onclick: () => void
}

/** How a toast reads and behaves. */
export type ToastOptions = {
  description?: string
  variant?: ToastVariant
  action?: ToastAction
  /** Milliseconds before it dismisses itself, paused while it has focus or the pointer. */
  duration?: number
}

/** A toast as the Toaster renders it. */
export type Toast = ToastOptions & {
  readonly id: string
  readonly title: string
  readonly variant: ToastVariant
  /** Where focus was when the toast appeared, to return to when the last toast closes. */
  readonly origin: Element | null
  /** Held back while a modal dialog is open, where it would be missed. */
  held: boolean
  closing: boolean
}

/** How long the exit transition runs before a closing toast is removed. */
const EXIT_MS = 200

const toasts = $state<Toast[]>([])
let count = 0

/**
 * Reads a toast to screen readers: only its visible text, and a note when it holds an action,
 * never the names of its buttons.
 */
function announce(item: Toast): void {
  const parts = [item.title, item.description, item.action ? '操作があります' : undefined]
  document.ariaNotify(parts.filter(Boolean).join('。'))
}

/** The toasts, oldest first; held toasts are included and marked. */
export function listToasts(): readonly Toast[] {
  return toasts
}

/**
 * Shows a toast, or holds it until the open modal dialog closes.
 *
 * @returns The toast's id, for {@link dismissToast}.
 */
export function toast(title: string, options: ToastOptions = {}): string {
  count += 1
  const item: Toast = {
    ...options,
    id: `toast-${count}`,
    title,
    variant: options.variant ?? 'neutral',
    origin: document.activeElement,
    held: document.querySelector('dialog:modal') !== null,
    closing: false,
  }
  toasts.push(item)
  if (!item.held) announce(item)
  return item.id
}

/** Shows and announces the held toasts, once no modal dialog is open. */
export function releaseHeldToasts(): void {
  if (document.querySelector('dialog:modal')) return
  for (const item of toasts) {
    if (!item.held) continue
    item.held = false
    announce(item)
  }
}

/** Plays a toast's exit, then removes it. */
export function dismissToast(id: string): void {
  const item = toasts.find((candidate) => candidate.id === id)
  if (!item || item.closing) return
  item.closing = true
  setTimeout(() => {
    const index = toasts.findIndex((candidate) => candidate.id === id)
    if (index >= 0) toasts.splice(index, 1)
  }, EXIT_MS)
}
