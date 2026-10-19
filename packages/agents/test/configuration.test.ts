import { describe, expect, it } from 'vitest'
import { agentConfigSchema, defaultAgentConfig } from '../src/configuration/index.ts'
import { createAgentModels } from '../src/models/index.ts'
import { parseInput } from '../src/validation.ts'

const schema = agentConfigSchema(createAgentModels({}))
const valid = defaultAgentConfig({
  DEFAULT_MODEL_PROVIDER: 'openai',
  DEFAULT_MODEL_ID: 'gpt-6-luna',
})

describe('agent configuration schema', () => {
  it('accepts a complete configuration with registered tools', () => {
    const config = { ...valid, thinkingLevel: 'high', tools: ['current_time'] }
    expect(parseInput(schema, config)).toEqual(config)
  })

  it('rejects unknown fields, thinking levels, models, and tools as client errors', () => {
    for (const [invalid, message] of [
      [{ ...valid, apiKey: 'secret' }, 'provider and modelId'],
      [{ ...valid, thinkingLevel: 'extreme' }, 'thinkingLevel'],
      [{ ...valid, model: { provider: 'openai', modelId: 'missing' } }, 'Unknown model'],
      [{ ...valid, tools: ['unknown_tool'] }, 'Unknown tool: unknown_tool'],
      [{ ...valid, tools: ['current_time', 'current_time'] }, 'unique'],
    ] as const) {
      expect(() => parseInput(schema, invalid)).toThrow(TypeError)
      expect(() => parseInput(schema, invalid)).toThrow(message)
    }
  })
})
