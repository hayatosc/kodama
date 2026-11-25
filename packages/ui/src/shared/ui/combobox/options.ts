/**
 * The options a Combobox offers.
 *
 * @module
 */

/** One option. */
export type ComboboxOption = {
  /** What the Combobox's value becomes; also what search matches. */
  value: string
  /** Shown instead of the value, and matched by search too. */
  label?: string
  /** A heading the option is listed under. */
  group?: string
  disabled?: boolean
}
