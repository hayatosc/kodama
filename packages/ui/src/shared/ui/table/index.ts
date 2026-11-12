/**
 * Table in the shape of shadcn-svelte's, on the native table elements.
 *
 * @module
 */

import Body from './TableBody.svelte'
import Caption from './TableCaption.svelte'
import Cell from './TableCell.svelte'
import Footer from './TableFooter.svelte'
import Head from './TableHead.svelte'
import Header from './TableHeader.svelte'
import Row from './TableRow.svelte'
import Root from './Table.svelte'

/** The parts of a table: Root is the <table> in its scroll area, and the rest its native parts. */
export { Root, Caption, Header, Body, Footer, Row, Head, Cell }
