/**
 * Button styles and props from design/components/Button, shared by Button and the dialog buttons.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'
import { focusRing, type WithElementRef } from '#lib/utils.js'
import type { HTMLButtonAttributes } from 'svelte/elements'

/**
 * Button styles from design/components/Button: four variants and four sizes. Hover changes the
 * fill, a press scales the button down (it dims instead under a reduced-motion request), and
 * keyboard focus draws the outline ring, so each state looks different.
 */
export const buttonVariants = tv({
  base: [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent',
    'font-semibold whitespace-nowrap select-none',
    'transition-[color,background-color,border-color,opacity,scale] duration-[120ms] ease-out',
    'motion-safe:active:scale-[0.97] motion-reduce:active:opacity-80',
    'disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none',
    'aria-disabled:pointer-events-none aria-disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ],
  variants: {
    variant: {
      /** The one main action of a surface, inverted: black on light, white on dark. */
      primary: 'bg-primary text-primary-foreground shadow-sm hover:opacity-90',
      /** Outlined, for every other action. */
      secondary: 'border-input bg-background text-foreground shadow-sm hover:bg-accent',
      /** No surface until hover, for actions inside dense parts. */
      ghost: 'bg-transparent text-foreground hover:bg-accent',
      /** Actions that delete or discard; confirm them first with an AlertDialog. */
      destructive: 'bg-destructive-soft text-destructive hover:opacity-90',
    },
    size: {
      default: 'h-9 px-3 text-base',
      sm: 'h-8 rounded-md px-2 text-sm',
      /** A square for one icon; give the button an `aria-label`. */
      icon: 'size-9 p-0',
      'icon-sm': 'size-8 rounded-md p-0',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'default',
  },
})

/** One of the design's four button variants. */
export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']

/** One of the four button sizes. */
export type ButtonSize = VariantProps<typeof buttonVariants>['size']

/** A button. Icon-only buttons need `aria-label`. */
export type ButtonProps = WithElementRef<HTMLButtonAttributes> & {
  variant?: ButtonVariant
  size?: ButtonSize
}
