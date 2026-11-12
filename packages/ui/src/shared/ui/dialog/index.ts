/**
 * Dialog in the shape of shadcn-svelte's, built on the native modal <dialog>, styled as
 * design/components/Dialog.
 *
 * @module
 */

import Close from './DialogClose.svelte'
import Content from './DialogContent.svelte'
import Description from './DialogDescription.svelte'
import Footer from './DialogFooter.svelte'
import Header from './DialogHeader.svelte'
import Title from './DialogTitle.svelte'
import Trigger from './DialogTrigger.svelte'
import Root from './Dialog.svelte'

/**
 * The parts of a modal dialog, used as `Dialog.Root`, `Dialog.Content`, …. Root owns `open`;
 * Trigger and Close open and close it with invoker commands.
 */
export { Root, Trigger, Content, Header, Footer, Title, Description, Close }
