/**
 * Drawer in the shape of shadcn-svelte's Sheet: a Dialog that slides in from an edge of the viewport,
 * for side content such as settings or details.
 *
 * @module
 */

import Close from '../dialog/DialogClose.svelte'
import Description from '../dialog/DialogDescription.svelte'
import Footer from '../dialog/DialogFooter.svelte'
import Header from '../dialog/DialogHeader.svelte'
import Title from '../dialog/DialogTitle.svelte'
import Trigger from '../dialog/DialogTrigger.svelte'
import Root from '../dialog/Dialog.svelte'
import Content from './DrawerContent.svelte'

/** The parts of a drawer, used as `Drawer.Root`, `Drawer.Content`, …, the same as Dialog's. */
export { Root, Trigger, Content, Header, Footer, Title, Description, Close }
