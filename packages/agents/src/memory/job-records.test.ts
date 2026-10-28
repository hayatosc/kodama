/**
 * A record's ownership and starting importance come from the job, not from the model.
 *
 * @module
 */
import { describe, expect, it } from 'vitest'
import { uuidv7 } from '../lib/uuid.ts'
import { recordFor } from './job-records.ts'

const agentId = uuidv7()
const remember = (origin: 'user_request' | 'agent_judgment') =>
  ({
    kind: 'remember',
    sourceAgentId: agentId,
    origin,
    content: 'Prefer tabs',
    sourceEntries: { from: 3, to: 4 },
  }) as const

describe('recordFor', () => {
  it('starts a requested memory at importance 0.7 and a judged one at 0.4', () => {
    for (const [origin, importance] of [
      ['user_request', 0.7],
      ['agent_judgment', 0.4],
    ] as const) {
      expect(recordFor(remember(origin), { kind: 'fact', content: ' Prefer tabs ' }, 1)).toEqual({
        scope: `agent:${agentId}`,
        sourceAgentId: agentId,
        origin,
        sourceEntries: { from: 3, to: 4 },
        kind: 'fact',
        content: 'Prefer tabs',
        importance,
        observedAt: 1,
      })
    }
  })

  it('keeps an importance the memory agent chose', () => {
    const args = { kind: 'fact', content: 'Prefer tabs', importance: 0.9 } as const
    expect(recordFor(remember('agent_judgment'), args, 1).importance).toBe(0.9)
  })
})
