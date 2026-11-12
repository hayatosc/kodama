/**
 * Field in the shape of shadcn-svelte's: a control with its label, description, and error,
 * linked by ids the field makes, and fieldsets that group fields.
 *
 * @module
 */

import Content from './FieldContent.svelte'
import Description from './FieldDescription.svelte'
import FieldError from './FieldError.svelte'
import Group from './FieldGroup.svelte'
import Label from './FieldLabel.svelte'
import Legend from './FieldLegend.svelte'
import FieldSet from './FieldSet.svelte'
import Root from './Field.svelte'

/**
 * The parts of a form field, used as `Field.Root`, `Field.Label`, …. Controls inside a Root take
 * its id, description, error, and invalid state.
 */
export { Root, Label, Description, FieldError as Error, Content, FieldSet as Set, Legend, Group }
