import type { ToolRegistration } from '@earendil-works/pi-durable'
import { currentTimeTool } from './current-time.ts'

/** Register tool implementations here; each agent enables an explicit subset by name. */
export const agentTools: readonly ToolRegistration[] = [currentTimeTool]

export function resolveTools(names: readonly string[]): ToolRegistration[] {
  return names.map((name) => {
    const tool = agentTools.find((candidate) => candidate.name === name)
    if (!tool) throw new TypeError(`Unknown tool: ${name}`)
    return tool
  })
}
