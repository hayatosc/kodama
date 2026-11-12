/**
 * Attributes the platform has that svelte/elements does not list yet.
 *
 * @module
 */

import 'svelte/elements'

declare module 'svelte/elements' {
  interface HTMLAttributes<T extends EventTarget> {
    /** Arrow-key focus navigation among the element's items (focusgroup; limited availability). */
    focusgroup?: string | undefined | null
  }

  interface HTMLButtonAttributes {
    /** The id of a hint popover shown on hover, focus, or long press (interest invokers). */
    interestfor?: string | undefined | null
  }

  interface HTMLAnchorAttributes {
    /** The id of a hint popover shown on hover, focus, or long press (interest invokers). */
    interestfor?: string | undefined | null
  }
}
