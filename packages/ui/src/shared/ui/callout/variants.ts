/**
 * Callout styles: a bordered box whose tint follows its tone.
 *
 * @module
 */

import { type VariantProps, tv } from 'tailwind-variants'

/** An callout's box: an icon column and a text column, tinted by tone. */
export const calloutVariants = tv({
  base: [
    'grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-xl border px-4 py-3 text-sm',
    'has-[>svg]:grid-cols-[16px_1fr] has-[>svg]:gap-x-3 [&>svg]:mt-0.5 [&>svg]:size-4',
  ],
  variants: {
    variant: {
      neutral: 'border-border bg-card text-foreground [&>svg]:text-muted-foreground',
      live: 'border-live/30 bg-live-soft text-foreground [&>svg]:text-live',
      running: 'border-running/30 bg-running-soft text-foreground [&>svg]:text-running',
      destructive:
        'border-destructive/30 bg-destructive-soft text-foreground [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'neutral' },
})

/** One of the callout tones. */
export type CalloutVariant = VariantProps<typeof calloutVariants>['variant']
