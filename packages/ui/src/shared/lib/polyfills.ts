/**
 * Polyfills for platform features short of Baseline, each loaded only where the browser lacks
 * the feature. Baseline features are used without one.
 *
 * @module
 */

let interestFor: Promise<void> | undefined

/**
 * Loads the interestfor polyfill (interest invokers, which open tooltips on hover and focus) in
 * browsers without them. Safe to call many times and during server rendering.
 */
export function loadInterestForPolyfill(): Promise<void> {
  if (typeof HTMLButtonElement === 'undefined') return Promise.resolve()
  if ('interestForElement' in HTMLButtonElement.prototype) return Promise.resolve()
  interestFor ??= import('interestfor').then(() => undefined)
  return interestFor
}
