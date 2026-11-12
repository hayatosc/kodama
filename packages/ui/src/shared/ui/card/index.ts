/**
 * Card in the shape of shadcn-svelte's, on <article>, <header>, and <footer>.
 *
 * @module
 */

import Action from './CardAction.svelte'
import Content from './CardContent.svelte'
import Description from './CardDescription.svelte'
import Footer from './CardFooter.svelte'
import Header from './CardHeader.svelte'
import Title from './CardTitle.svelte'
import Root from './Card.svelte'

/** The parts of a card, used as `Card.Root`, `Card.Header`, `Card.Title`, …. */
export { Root, Header, Title, Description, Action, Content, Footer }
