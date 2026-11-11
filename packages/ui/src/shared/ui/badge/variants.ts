/**
 * Badge styles from design/components/StatusBadge.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'

/**
 * A short label, 22px high, tinted by variant. The transparent border becomes visible in forced
 * colors mode, where the tinted background is removed, so the badge keeps its outline there.
 */
export const badgeVariants = tv({
  base: [
    'inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2',
    "text-xs font-semibold whitespace-nowrap [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3",
  ],
  variants: {
    variant: {
      neutral: 'bg-muted text-muted-foreground',
      outline: 'border-border bg-transparent text-foreground',
      /** The live color, for something active now. */
      live: 'bg-live-soft text-live',
      /** The running color, for work in progress. */
      running: 'bg-running-soft text-running',
      destructive: 'bg-destructive-soft text-destructive',
    },
  },
  defaultVariants: {
    variant: 'neutral',
  },
})

/** One of the badge variants. */
export type BadgeVariant = VariantProps<typeof badgeVariants>['variant']
