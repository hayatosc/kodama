/**
 * A record's ownership and evidence come from the job, not from the model.
 *
 * @module
 */
import { describe, expect, it } from 'vitest'
import { uuidv7 } from '../../lib/uuid.ts'
import { recordFor } from './records.ts'

const agentId = uuidv7()
const remember = {
  kind: 'remember',
  sourceAgentId: agentId,
  content: 'Prefer tabs',
  sourceEntries: { from: 3, to: 4 },
} as const

describe('recordFor', () => {
  it("writes a remembered record to the agent's scope with the job's entries as evidence", () => {
    expect(recordFor(remember, { kind: 'fact', content: ' Prefer tabs ' }, 1)).toEqual({
      scope: `agent:${agentId}`,
      sourceAgentId: agentId,
      origin: 'remember',
      sourceEntries: { from: 3, to: 4 },
      kind: 'fact',
      content: 'Prefer tabs',
      importance: undefined,
      observedAt: 1,
    })
  })

  it('keeps an importance the memory agent chose', () => {
    const args = { kind: 'fact', content: 'Prefer tabs', importance: 0.9 } as const
    expect(recordFor(remember, args, 1).importance).toBe(0.9)
  })
})
