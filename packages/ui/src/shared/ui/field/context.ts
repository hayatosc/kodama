/**
 * The state a field shares with the control and texts inside it, so the label, the description,
 * and the error are linked to the control without ids written by hand.
 *
 * @module
 */

import { getContext, setContext } from 'svelte'

const key = Symbol('field')

/** Shared by Field.Root, which owns it, and the parts and controls inside it. */
export type FieldState = {
  /** The base of the ids: the control is `${id}-control`. */
  readonly id: string
  /** Set by Field.Root; controls mark themselves invalid while it is true. */
  readonly invalid: boolean
  /** Whether a Field.Description is rendered. */
  described: boolean
  /** Whether a Field.Error is rendered. */
  erred: boolean
}

/** Provides a field's state to the parts inside it. */
export function setFieldState(state: FieldState): void {
  setContext(key, state)
}

/** The nearest Field.Root's state, or undefined for a control outside a field. */
export function getFieldState(): FieldState | undefined {
  return getContext<FieldState | undefined>(key)
}

/** The ids and ARIA states a control takes from its field. */
export type FieldControlAttributes = {
  id: string | undefined
  'aria-describedby': string | undefined
  'aria-invalid': boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined
}

/**
 * The control's id, description links, and invalid state: the caller's own values first, then
 * the field's. Outside a field, the caller's values pass through.
 */
export function fieldControlAttributes(
  field: FieldState | undefined,
  own: {
    id?: string | null
    'aria-describedby'?: string | null
    'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling' | null
  },
): FieldControlAttributes {
  const describedBy = [
    own['aria-describedby'],
    field?.described ? `${field.id}-description` : undefined,
    field?.erred ? `${field.id}-error` : undefined,
  ].filter((id) => typeof id === 'string' && id !== '')
  return {
    id: own.id ?? (field ? `${field.id}-control` : undefined),
    'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
    'aria-invalid': own['aria-invalid'] ?? (field?.invalid ? true : undefined),
  }
}
