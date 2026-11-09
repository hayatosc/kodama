/**
 * Button styles and props from design/components/Button, shared by Button and the dialog buttons.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'
import { focusRing, type WithElementRef } from '#lib/utils.js'
import type { HTMLButtonAttributes } from 'svelte/elements'

/** Button styles from design/components/Button: four variants and six sizes. */
export const buttonVariants = tv({
  base: [
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent',
    'font-semibold whitespace-nowrap transition-colors duration-[120ms] select-none',
    'disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none',
    'aria-disabled:pointer-events-none aria-disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ],
  variants: {
    variant: {
      /** The one main action of a surface, inverted: black on light, white on dark. */
      primary: 'bg-primary text-primary-foreground shadow-sm hover:opacity-90',
      secondary: 'border-input bg-background text-foreground shadow-sm hover:bg-accent',
      ghost: 'bg-transparent text-foreground hover:bg-accent',
      /** Archive and delete; they go through a confirmation dialog. */
      destructive: 'bg-destructive-soft text-destructive hover:opacity-90',
    },
    size: {
      default: 'h-9 px-3 text-base',
      sm: 'h-8 rounded-md px-2 text-sm',
      icon: 'size-9 p-0',
      round: 'size-9 rounded-full p-0',
      /** Sidebar search and create, the right pane's share: an outlined circle on the surface. */
      circle:
        'size-8 rounded-full border-border bg-background p-0 text-foreground shadow-none hover:bg-accent hover:opacity-100',
      /** Small actions that blend into the surface, such as the Composer's attach. */
      chip: [
        'h-7 gap-1 rounded-full bg-transparent px-2 text-xs font-normal text-muted-foreground shadow-none',
        'hover:bg-accent hover:text-foreground hover:opacity-100',
        'has-[>svg:only-child]:w-8 has-[>svg:only-child]:px-0',
      ],
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'default',
  },
})

/** One of the design's four button variants. */
export type ButtonVariant = VariantProps<typeof buttonVariants>['variant']

/** One of the design's button sizes. */
export type ButtonSize = VariantProps<typeof buttonVariants>['size']

/** A button. Icon-only buttons need `aria-label`. */
export type ButtonProps = WithElementRef<HTMLButtonAttributes> & {
  variant?: ButtonVariant
  size?: ButtonSize
}
