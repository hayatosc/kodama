/** Provider authentication never reads ambient keys and uses only the explicit store. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { createAgentModels } from './index.ts'

afterEach(() => vi.unstubAllEnvs())

it('cannot authenticate from provider environment keys', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-ambient-key')
  vi.stubEnv('XAI_API_KEY', 'xai-ambient-key')
  expect(await createAgentModels().checkAuth('openai')).toBeUndefined()
  expect(await createAgentModels().checkAuth('xai')).toBeUndefined()
})

it('authenticates through an explicit credential store', async () => {
  const models = createAgentModels({
    read: async () => ({ type: 'api_key', key: 'sk-explicit-key' }),
    list: async () => [{ providerId: 'openai', type: 'api_key' }],
    modify: async () => {
      throw new Error('Not supported')
    },
    delete: async () => {
      throw new Error('Not supported')
    },
  })
  expect(await models.checkAuth('openai')).toEqual({ type: 'api_key', source: 'stored credential' })
})
