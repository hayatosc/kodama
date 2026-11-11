/**
 * AlertDialog in the shape of shadcn-svelte's: a Dialog that asks before an action, exposed as
 * role="alertdialog", with Cancel and Action instead of the × button.
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
import Action from './alert-dialog-action.svelte'
import Content from './alert-dialog-content.svelte'

/**
 * The parts of an alert dialog, used as `AlertDialog.Root`, `AlertDialog.Content`, …. Cancel
 * closes it; Action runs its handler, then closes it.
 */
export { Root, Trigger, Content, Header, Footer, Title, Description, Close as Cancel, Action }
