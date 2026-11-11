/**
 * Table in the shape of shadcn-svelte's, on the native table elements.
 *
 * @module
 */

import Body from './table-body.svelte'
import Caption from './table-caption.svelte'
import Cell from './table-cell.svelte'
import Footer from './table-footer.svelte'
import Head from './table-head.svelte'
import Header from './table-header.svelte'
import Row from './table-row.svelte'
import Root from './table.svelte'

/** The parts of a table: Root is the <table> in its scroll area, and the rest its native parts. */
export { Root, Caption, Header, Body, Footer, Row, Head, Cell }
