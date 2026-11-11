/**
 * Drawer in the shape of shadcn-svelte's Sheet: a Dialog that slides in from an edge of the viewport,
 * for side content such as settings or details.
 *
 * @module
 */

import Close from '../dialog/dialog-close.svelte'
import Description from '../dialog/dialog-description.svelte'
import Footer from '../dialog/dialog-footer.svelte'
import Header from '../dialog/dialog-header.svelte'
import Title from '../dialog/dialog-title.svelte'
import Trigger from '../dialog/dialog-trigger.svelte'
import Root from '../dialog/dialog.svelte'
import Content from './drawer-content.svelte'

/** The parts of a drawer, used as `Drawer.Root`, `Drawer.Content`, …, the same as Dialog's. */
export { Root, Trigger, Content, Header, Footer, Title, Description, Close }
