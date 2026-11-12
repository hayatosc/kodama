/**
 * Toast in the shape of shadcn-svelte's Sonner: `toast()` adds a notification, and the one
 * Toaster on the page shows it.
 *
 * @module
 */

/** The region that shows toasts; render it once, near the end of the layout. */
export { default as Toaster } from './Toaster.svelte'
/** Adds, dismisses, and lists toasts. */
export {
  dismissToast,
  listToasts,
  toast,
  type Toast,
  type ToastAction,
  type ToastOptions,
  type ToastVariant,
} from './state.svelte.js'
