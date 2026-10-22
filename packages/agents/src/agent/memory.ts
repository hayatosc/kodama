/** Long-term memory as one working agent object uses it (Working agents, Extract). */
import type { Extension, Harness } from '@earendil-works/pi-durable'
import { extractionCheckpoint, memoryDb } from '../memory/store/db.ts'
import { AlwaysLoadedMemory } from '../memory/working/always-loaded.ts'
import { createWorkingMemoryExtension } from '../memory/working/extension.ts'
import { MEMORY_AGENT_NAME } from '../memory/jobs.ts'
import type { WorkingMemoryDeps } from '../memory/working/deps.ts'
import { latestEntryId } from './entries.ts'

/** An agent idle this long gets its new entries extracted into long-term memory. */
export const EXTRACT_IDLE_DELAY_MS = 10 * 60_000

export class AgentMemory {
  readonly #deps: WorkingMemoryDeps
  readonly #copy: AlwaysLoadedMemory
  /** A change arrived while busy; refresh at the next idle moment. */
  #changed = false

  constructor(deps: WorkingMemoryDeps) {
    this.#deps = deps
    this.#copy = new AlwaysLoadedMemory(deps)
  }

  /** The tools and sections every working agent gets. */
  extension(): Extension {
    return createWorkingMemoryExtension(this.#deps, this.#copy)
  }

  /** Render the always-loaded copy again. Memory is an aid: a failure is logged. */
  refresh(): Promise<void> {
    return this.#quietly(() => this.#copy.refresh())
  }

  /** Before input while idle: render again if a scope revision changed. */
  refreshIfChanged(): Promise<void> {
    return this.#quietly(() => this.#copy.refreshIfChanged())
  }

  /** The memory agent changed this agent's memory: refresh now if idle, else when next idle. */
  async changed(idle: boolean): Promise<void> {
    if (idle) await this.refresh()
    else this.#changed = true
  }

  async onIdle(): Promise<void> {
    if (!this.#changed) return
    this.#changed = false
    await this.refresh()
  }

  /** Hand the entries extraction has not covered to the memory agent. */
  async extract(harness: Harness): Promise<void> {
    const agentId = this.#deps.agentId()
    const latest = await latestEntryId(harness)
    const checkpoint = await extractionCheckpoint(memoryDb(this.#deps.env.MEMORY_DB), agentId)
    if (latest === undefined || latest <= checkpoint) return
    await this.#deps.env.MEMORY_AGENT.getByName(MEMORY_AGENT_NAME).enqueue({
      kind: 'extract',
      sourceAgentId: agentId,
      afterEntry: checkpoint,
    })
  }

  async #quietly(refresh: () => Promise<void>): Promise<void> {
    try {
      await refresh()
    } catch (error) {
      console.error('Long-term memory refresh failed', error)
    }
  }
}
