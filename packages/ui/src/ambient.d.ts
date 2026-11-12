/**
 * Types the platform has that the installed TypeScript DOM library does not list yet.
 *
 * @module
 */

/** ariaNotify (Baseline 2026): asks assistive technology to announce a message. */
interface AriaNotifyOptions {
  priority?: 'normal' | 'high'
}

interface Document {
  ariaNotify(announcement: string, options?: AriaNotifyOptions): void
}

interface Element {
  ariaNotify(announcement: string, options?: AriaNotifyOptions): void
}

/** The interestfor polyfill registers itself on import and exports nothing. */
declare module 'interestfor'
