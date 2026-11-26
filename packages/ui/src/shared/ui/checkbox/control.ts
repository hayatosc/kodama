/**
 * The look Checkbox and RadioGroupItem share (checkbox guide, brand-consistent-forms).
 *
 * @module
 */

/**
 * A native checkbox or radio with appearance: none, 16px, and a 1px border in the input color
 * (3:1 against the page). The mark is the ::before, painted in the foreground through a mask
 * (CanvasText in forced colors mode) and scaled in when the control is checked. Checked fills
 * with primary, so the state is a shape and a fill, not a color alone.
 */
export const choiceControl = [
  'm-0 inline-grid size-4 shrink-0 cursor-pointer appearance-none place-content-center border border-input bg-background',
  'checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary',
  'user-invalid:border-destructive aria-invalid:border-destructive',
  'disabled:cursor-not-allowed disabled:opacity-40',
  'before:size-2.5 before:scale-0 before:bg-primary-foreground checked:before:scale-100 indeterminate:before:scale-100 forced-colors:before:bg-[CanvasText]',
  'motion-safe:before:transition-[scale] motion-safe:before:duration-[120ms] motion-safe:before:ease-out',
].join(' ')
