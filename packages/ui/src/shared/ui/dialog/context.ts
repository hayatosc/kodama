/**
 * The state a dialog's parts share: the <dialog>'s id, whether it is open, and which of the title
 * and description are rendered (so aria-labelledby and aria-describedby point only at them).
 *
 * @module
 */

import { createContext } from 'svelte'

/** Shared by Root, which owns it, and the parts inside it. */
export type DialogState = {
  /** The <dialog>'s id, which Trigger and Close name in `commandfor`. */
  readonly id: string
  open: boolean
  labelled: boolean
  described: boolean
}

/** Reads and provides the state of the nearest Dialog.Root or AlertDialog.Root. */
export const [getDialogState, setDialogState] = createContext<DialogState>()
