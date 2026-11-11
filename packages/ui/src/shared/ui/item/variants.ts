/**
 * Item styles: a row with media, text, and actions.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'

/** An item row, plain, outlined, or on muted, at two densities. */
export const itemVariants = tv({
  base: 'flex w-full min-w-0 items-center gap-3 rounded-xl text-start text-sm text-foreground',
  variants: {
    variant: {
      plain: 'bg-transparent',
      outline: 'border border-border',
      muted: 'bg-muted',
    },
    size: {
      default: 'min-h-14 px-3 py-2.5',
      sm: 'min-h-11 px-2.5 py-1.5',
    },
  },
  defaultVariants: { variant: 'plain', size: 'default' },
})

/** One of the item looks. */
export type ItemVariant = VariantProps<typeof itemVariants>['variant']

/** One of the item densities. */
export type ItemSize = VariantProps<typeof itemVariants>['size']
