/**
 * Field in the shape of shadcn-svelte's: a control with its label, description, and error,
 * linked by ids the field makes, and fieldsets that group fields.
 *
 * @module
 */

import Content from './field-content.svelte'
import Description from './field-description.svelte'
import FieldError from './field-error.svelte'
import Group from './field-group.svelte'
import Label from './field-label.svelte'
import Legend from './field-legend.svelte'
import FieldSet from './field-set.svelte'
import Root from './field.svelte'

/**
 * The parts of a form field, used as `Field.Root`, `Field.Label`, …. Controls inside a Root take
 * its id, description, error, and invalid state.
 */
export { Root, Label, Description, FieldError as Error, Content, FieldSet as Set, Legend, Group }
