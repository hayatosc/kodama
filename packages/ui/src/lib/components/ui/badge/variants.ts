/**
 * Badge styles from design/components/StatusBadge.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'

/** Badge styles from design/components/StatusBadge: a tinted label, 22px high. */
export const badgeVariants = tv({
  base: 'inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold whitespace-nowrap',
  variants: {
    variant: {
      neutral: 'bg-muted text-muted-foreground',
      live: 'bg-live-soft text-live',
      running: 'bg-running-soft text-running',
      destructive: 'bg-destructive-soft text-destructive',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
})

/** One of the badge tints: neutral, or one of the three status colors. */
export type BadgeVariant = VariantProps<typeof badgeVariants>['variant']
