/**
 * The box Checkbox and RadioGroupItem share (checkbox guide, brand-consistent-forms).
 *
 * @module
 */

/**
 * A native checkbox or radio with appearance: none, 16px, and a 1px border in the input color
 * (3:1 against the page). Checked fills with primary, so the state is a shape and a fill, not a
 * color alone; each component draws its own mark over the fill.
 *
 * @remarks
 * The indeterminate state belongs to Checkbox alone: a radio matches :indeterminate whenever no
 * radio in its group is checked, so styling it here would fill an unanswered group with primary.
 */
export const choiceControl = [
  'm-0 inline-grid size-4 shrink-0 cursor-pointer appearance-none place-content-center border border-input bg-background',
  'checked:border-primary checked:bg-primary',
  'user-invalid:border-destructive aria-invalid:border-destructive',
  'disabled:cursor-not-allowed',
].join(' ')
