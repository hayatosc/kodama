/** Definition admission, digest pinning, and runtime validation fixtures. @module */
import { describe, expect, it } from 'vite-plus/test'
import { inspectMcpSchema, inspectMcpTool, mcpDigest, validateMcpValue } from './definitions.ts'

const definition = {
  name: 'read',
  description: 'External description, not an instruction.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 3 },
      count: { type: 'integer', minimum: 1, maximum: 3 },
      tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, maxItems: 2 },
    },
    required: ['id'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
}

describe('MCP definitions', () => {
  it('retains the exact supported schema for both model presentation and runtime validation', async () => {
    const result = await inspectMcpTool(definition)
    expect(result.rejection).toBeNull()
    expect(result.definition).toBe(definition)
    expect(inspectMcpSchema(definition.inputSchema)).toBe(definition.inputSchema)
    expect(() =>
      validateMcpValue(definition.inputSchema, { id: 'x', count: 2, tags: ['a'] }),
    ).not.toThrow()
  })

  it.each([
    {},
    { id: '' },
    { id: 'long' },
    { id: 'x', count: 1.5 },
    { id: 'x', count: 0 },
    { id: 'x', count: 4 },
    { id: 'x', tags: ['other'] },
    { id: 'x', tags: ['a', 'a', 'a'] },
    { id: 'x', additional: true },
  ])('rejects arguments violating the published schema: %j', (value) => {
    expect(() => validateMcpValue(definition.inputSchema, value)).toThrow()
  })

  it.each([
    { type: 'object', $ref: 'https://example.com/schema' },
    { type: 'object', $ref: '#/$defs/local' },
    { type: 'object', $schema: 'unknown' },
    { type: 'object', patternProperties: {} },
    { type: 'object', additionalProperties: { type: 'string' } },
    { type: 'array' },
    { type: 'string', minLength: -1 },
    { type: 'object', required: ['id', 'id'] },
  ])('retains unsupported definitions for review without admitting them', async (inputSchema) => {
    const result = await inspectMcpTool({ ...definition, inputSchema })
    expect(result.rejection).toBe('unsupported_definition')
    expect(result.definition.inputSchema).toBe(inputSchema)
  })

  it('rejects unsupported output schemas even when inputs are supported', async () => {
    expect(
      (await inspectMcpTool({ ...definition, outputSchema: { type: 'object', $ref: '#' } }))
        .rejection,
    ).toBe('unsupported_definition')
  })

  it('bounds recursive schema depth', () => {
    let schema: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 21; i++) schema = { type: 'array', items: schema }
    expect(() => inspectMcpSchema(schema)).toThrow('mcp_schema_depth')
  })

  it('pins descriptions, schemas and annotations, ignoring only object key ordering', async () => {
    expect(await mcpDigest({ b: 2, a: 1 })).toBe(await mcpDigest({ a: 1, b: 2 }))
    const digest = await mcpDigest(definition)
    for (const changed of [
      { ...definition, description: 'changed' },
      { ...definition, annotations: { readOnlyHint: false } },
      { ...definition, outputSchema: { type: 'string' } },
    ])
      expect(await mcpDigest(changed)).not.toBe(digest)
  })

  it('compares structured enum values structurally and counts Unicode code points', () => {
    expect(() =>
      validateMcpValue({ type: 'object', enum: [{ a: 1, b: 2 }] }, { b: 2, a: 1 }),
    ).not.toThrow()
    expect(() => validateMcpValue({ type: 'string', maxLength: 1 }, '😀')).not.toThrow()
    expect(() => validateMcpValue({ type: 'string', maxLength: 1 }, '😀😀')).toThrow()
  })
})
