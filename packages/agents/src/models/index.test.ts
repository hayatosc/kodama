import { describe, expect, it } from 'vitest'
import { resolveProviderCredentials } from './index.ts'

describe('provider credentials', () => {
  it('loads individual keys and ignores unused providers', () => {
    expect(
      Object.fromEntries(
        resolveProviderCredentials({
          OPENAI_API_KEY: 'openai-test',
          XAI_API_KEY: 'xai-test',
          GEMINI_API_KEY: '',
        }),
      ),
    ).toEqual({ OPENAI_API_KEY: 'openai-test', XAI_API_KEY: 'xai-test' })
    expect(resolveProviderCredentials({}).size).toBe(0)
  })

  it('does not expose unrelated Worker secrets to model providers', () => {
    const env = { OPENAI_API_KEY: 'test-key', CLI_TOKEN: 'private-token' }
    expect(resolveProviderCredentials(env).has('CLI_TOKEN')).toBe(false)
  })
})
