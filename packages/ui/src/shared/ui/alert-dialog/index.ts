/**
 * AlertDialog in the shape of shadcn-svelte's: a Dialog that asks before an action, exposed as
 * role="alertdialog", with Cancel and Action instead of the × button.
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
import Action from './AlertDialogAction.svelte'
import Content from './AlertDialogContent.svelte'

/**
 * The parts of an alert dialog, used as `AlertDialog.Root`, `AlertDialog.Content`, …. Cancel
 * closes it; Action runs its handler, then closes it.
 */
export { Root, Trigger, Content, Header, Footer, Title, Description, Close as Cancel, Action }
