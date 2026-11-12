/**
 * Toggle styles: a button that stays pressed.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'
import { focusRing } from '#shared/lib/utils.js'

/**
 * A toggle button. The pressed state is styled from aria-pressed, so the look and the announced
 * state never disagree. Pressed adds a fill and a border in the input color (3:1 against the
 * page), since the fill alone is too faint; in forced colors mode it takes Highlight.
 */
export const toggleVariants = tv({
  base: [
    'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-transparent',
    'text-sm font-semibold whitespace-nowrap text-muted-foreground select-none',
    'transition-[color,background-color,border-color] duration-[120ms] ease-out',
    'hover:bg-accent hover:text-foreground',
    'aria-pressed:border-input aria-pressed:bg-accent aria-pressed:text-foreground',
    'forced-colors:aria-pressed:bg-[Highlight] forced-colors:aria-pressed:text-[HighlightText]',
    'disabled:pointer-events-none disabled:opacity-40',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ],
  variants: {
    variant: {
      plain: '',
      outline: 'border-input bg-background',
    },
    size: {
      default: 'h-9 min-w-9 px-2.5',
      sm: 'h-8 min-w-8 px-2',
    },
  },
  defaultVariants: { variant: 'plain', size: 'default' },
})

/** One of the toggle looks. */
export type ToggleVariant = VariantProps<typeof toggleVariants>['variant']

/** One of the toggle sizes. */
export type ToggleSize = VariantProps<typeof toggleVariants>['size']
