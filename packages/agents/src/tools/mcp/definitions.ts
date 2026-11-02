/** Strict, bounded MCP JSON Schema subset and pinned external definitions.
 * Unsupported keywords are rejected, never silently stripped or fetched.
 * @module
 */
import { array, record } from '../web/stream.ts'

const keywords = new Set([
  'type',
  'description',
  'title',
  'default',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  '$schema',
])
const types = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const bounds = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
]

/** Validate the complete schema, retaining the exact object used for model and runtime validation. */
export function inspectMcpSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 20) throw new Error('mcp_schema_depth')
  const schema = record(value)
  if (Object.keys(schema).some((key) => !keywords.has(key)))
    throw new Error('mcp_schema_unsupported')
  if (typeof schema.type !== 'string' || !types.has(schema.type))
    throw new Error('mcp_schema_unsupported')
  if (
    schema.$schema !== undefined &&
    schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
  )
    throw new Error('mcp_schema_unsupported')
  for (const key of ['title', 'description'])
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== 'string' || schema[key].length > 8_192)
    )
      throw new Error('mcp_schema_invalid')
  for (const key of bounds) {
    const bound = schema[key]
    if (bound !== undefined && (typeof bound !== 'number' || !Number.isFinite(bound)))
      throw new Error('mcp_schema_invalid')
    if (
      bound !== undefined &&
      ['minLength', 'maxLength', 'minItems', 'maxItems'].includes(key) &&
      (typeof bound !== 'number' || !Number.isSafeInteger(bound) || bound < 0)
    )
      throw new Error('mcp_schema_invalid')
  }
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 100)
  )
    throw new Error('mcp_schema_invalid')
  if (schema.properties !== undefined) {
    if (schema.type !== 'object') throw new Error('mcp_schema_invalid')
    for (const child of Object.values(record(schema.properties))) inspectMcpSchema(child, depth + 1)
  }
  if (
    schema.required !== undefined &&
    (!Array.isArray(schema.required) ||
      schema.required.some((name: unknown) => typeof name !== 'string') ||
      new Set(schema.required).size !== schema.required.length)
  )
    throw new Error('mcp_schema_invalid')
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean')
    throw new Error('mcp_schema_unsupported')
  if (schema.type === 'array') inspectMcpSchema(schema.items, depth + 1)
  else if (schema.items !== undefined) throw new Error('mcp_schema_invalid')
  if (JSON.stringify(schema).length > 65_536) throw new Error('mcp_schema_limit')
  return schema
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = record(value)
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`
}

/** Stable SHA-256 digest over the entire definition, including external descriptions and annotations. */
export async function mcpDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Validate input or structured output against precisely the supported schema semantics. */
export function validateMcpValue(schema: Record<string, unknown>, value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('mcp_value_invalid')
  const fail = () => {
    throw new Error('mcp_value_invalid')
  }
  if (
    schema.enum !== undefined &&
    !array(schema.enum).some((item) => canonical(item) === canonical(value))
  )
    fail()
  switch (schema.type) {
    case 'object': {
      const object = record(value)
      const properties = schema.properties === undefined ? {} : record(schema.properties)
      if (schema.required !== undefined)
        for (const name of array(schema.required))
          if (typeof name !== 'string' || !Object.hasOwn(object, name)) fail()
      for (const [name, item] of Object.entries(object)) {
        if (Object.hasOwn(properties, name))
          validateMcpValue(record(properties[name]), item, depth + 1)
        else if (schema.additionalProperties === false) fail()
      }
      break
    }
    case 'array': {
      if (!Array.isArray(value)) return fail()
      if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail()
      if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail()
      for (const item of value) validateMcpValue(record(schema.items), item, depth + 1)
      break
    }
    case 'string': {
      if (typeof value !== 'string') return fail()
      const length = Array.from(value).length
      if (typeof schema.minLength === 'number' && length < schema.minLength) fail()
      if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail()
      break
    }
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail()
      if (schema.type === 'integer' && !Number.isInteger(value)) fail()
      if (typeof schema.minimum === 'number' && value < schema.minimum) fail()
      if (typeof schema.maximum === 'number' && value > schema.maximum) fail()
      if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) fail()
      if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) fail()
      break
    case 'boolean':
      if (typeof value !== 'boolean') fail()
      break
    case 'null':
      if (value !== null) fail()
      break
    default:
      fail()
  }
}

/** Discovery retains rejected definitions for owner review, but cannot expose them as tools. */
export async function inspectMcpTool(value: unknown) {
  const definition = record(value)
  const digest = await mcpDigest(definition)
  if (typeof definition.name !== 'string' || !definition.name || definition.name.length > 256)
    throw new Error('mcp_catalog_invalid')
  let rejection: string | null = null
  try {
    if (
      definition.description !== undefined &&
      (typeof definition.description !== 'string' || definition.description.length > 8_192)
    )
      throw new Error('mcp_description_invalid')
    if (inspectMcpSchema(definition.inputSchema).type !== 'object')
      throw new Error('mcp_input_not_object')
    if (definition.outputSchema !== undefined) inspectMcpSchema(definition.outputSchema)
  } catch {
    rejection = 'unsupported_definition'
  }
  return { name: definition.name, digest, definition, rejection }
}
