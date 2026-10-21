/** Tools of the memory agent; working agents never get them. */
import type { ToolRegistration } from '@earendil-works/pi-durable'
import { archiveTools } from './archive.ts'
import type { MemoryToolDeps } from './common.ts'
import { extractionTools } from './extraction.ts'
import { recordTools } from './records.ts'
import { sharedTools } from './shared.ts'
import { skillTools } from './skills.ts'

export function createMemoryAgentTools(deps: MemoryToolDeps): ToolRegistration[] {
  return [
    ...sharedTools(deps),
    ...skillTools(deps),
    ...recordTools(deps),
    ...extractionTools(deps),
    ...archiveTools(deps),
  ]
}
