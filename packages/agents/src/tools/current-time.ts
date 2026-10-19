import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-durable'

export const currentTimeTool = defineTool({
  name: 'current_time',
  description: 'Read the current UTC time in ISO 8601 format.',
  parameters: Type.Object({}),
  replay: 'safe',
  execute: async () => ({ output: [{ type: 'text', text: new Date().toISOString() }] }),
})
