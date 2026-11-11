/**
 * Keeps `aria-invalid` in step with `:user-invalid`, which browsers do not expose to assistive
 * technology on their own. The control reads as valid until the user has interacted with it,
 * then as invalid while it matches `:user-invalid`.
 *
 * @module
 */

import type { Attachment } from 'svelte/attachments'

/** The controls `:user-invalid` applies to. */
type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

/**
 * An attachment that syncs `aria-invalid` from `:user-invalid` on blur, change, input, and a
 * blocked submit, and after a form reset.
 */
export const syncUserInvalid: Attachment<FormControl> = (control) => {
  const sync = (): void => {
    control.setAttribute('aria-invalid', String(control.matches(':user-invalid')))
  }
  const afterReset = (): void => {
    setTimeout(sync)
  }
  sync()
  const events = ['blur', 'change', 'input', 'invalid'] as const
  for (const type of events) control.addEventListener(type, sync)
  control.form?.addEventListener('reset', afterReset)
  return () => {
    for (const type of events) control.removeEventListener(type, sync)
    control.form?.removeEventListener('reset', afterReset)
  }
}
