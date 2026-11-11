/**
 * Class and prop helpers shared by the shadcn-svelte components.
 *
 * @module
 */

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Joins class values and lets later Tailwind utilities replace conflicting earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Props without bits-ui's `child` snippet, for components that always render their own element. */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T

/** Props without `children`, for components that render no content of their own. */
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T

/** Props without either snippet. */
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>

/** Props plus a bindable `ref` to the rendered element. */
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null }

/**
 * The focus ring every control uses: `ring` at 2px with a 2px offset, shown only for keyboard
 * focus (design/README.md — Focus). It is an outline rather than a box-shadow, because forced
 * colors mode removes box-shadows and would leave no focus indicator.
 */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
