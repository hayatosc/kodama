/**
 * Card in the shape of shadcn-svelte's, on <article>, <header>, and <footer>.
 *
 * @module
 */

import Action from './card-action.svelte'
import Content from './card-content.svelte'
import Description from './card-description.svelte'
import Footer from './card-footer.svelte'
import Header from './card-header.svelte'
import Title from './card-title.svelte'
import Root from './card.svelte'

/** The parts of a card, used as `Card.Root`, `Card.Header`, `Card.Title`, …. */
export { Root, Header, Title, Description, Action, Content, Footer }
