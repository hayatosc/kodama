/**
 * The registry of tools agents can enable by name. Memory tools are not here: every working agent
 * gets them through its memory extension.
 *
 * @module
 */
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { createContactAgentTool } from './contact.ts'
import type { ContactAgent } from './contact.ts'
import { createWebSearchTool } from './web/search.ts'
import type { WebCall } from './web/search.ts'
import { createWebFetchTool } from './web/fetch.ts'
import { currentTimeTool } from './current-time.ts'
import { createScheduleTools } from './scheduled-tasks.ts'
import type { ScheduleTools } from './scheduled-tasks.ts'

/** Every registered tool. Add a tool here; each agent enables an explicit subset by name. */
export const agentTools: readonly ToolRegistration[] = createAgentTools()

/** Bind runtime-only delivery while retaining the same opt-in names and schemas. */
export function createAgentTools(
  contact?: ContactAgent,
  web?: WebCall,
  schedule?: ScheduleTools,
): ToolRegistration[] {
  return [
    currentTimeTool,
    createContactAgentTool(contact),
    createWebSearchTool(web),
    createWebFetchTool(web),
    ...createScheduleTools(schedule),
  ]
}

const toolsByName = new Map(agentTools.map((tool) => [tool.name, tool]))

/** Whether a tool with this name is registered. */
export function isRegisteredTool(name: string): boolean {
  return toolsByName.has(name)
}

/**
 * The registered tools with these names, in the same order.
 *
 * @throws {@link TypeError} When a name is not registered.
 */
export function resolveTools(names: readonly string[]): ToolRegistration[] {
  return names.map((name) => {
    const tool = toolsByName.get(name)
    if (!tool) throw new TypeError(`Unknown tool: ${name}`)
    return tool
  })
}
