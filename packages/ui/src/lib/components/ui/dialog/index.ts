/**
 * Dialog in the shape of shadcn-svelte's, built on the native modal <dialog>, styled as
 * design/components/Dialog.
 *
 * @module
 */

import Close from './dialog-close.svelte'
import Content from './dialog-content.svelte'
import Description from './dialog-description.svelte'
import Footer from './dialog-footer.svelte'
import Header from './dialog-header.svelte'
import Title from './dialog-title.svelte'
import Trigger from './dialog-trigger.svelte'
import Root from './dialog.svelte'

/**
 * The parts of a modal dialog, used as `Dialog.Root`, `Dialog.Content`, …. Root owns `open`;
 * Trigger and Close open and close it with invoker commands.
 */
export { Root, Trigger, Content, Header, Footer, Title, Description, Close }
