/**
 * Applied-version reports cannot move backwards or exceed the desired registry version.
 *
 * @module
 */
import { eq } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { agents } from '../../drizzle/management/schema.ts'
import { management, newAgentId } from '../helper/management.ts'
import { reportApplied } from './versions.ts'

it('accepts progress only up to the desired version', async () => {
  const agentId = await newAgentId()
  await management
    .update(agents)
    .set({ currentVersion: 3, appliedVersion: 1 })
    .where(eq(agents.agentId, agentId))
  const applied = async () =>
    (await management.select().from(agents).where(eq(agents.agentId, agentId)).get())
      ?.appliedVersion

  await reportApplied(management, agentId, 4)
  expect(await applied()).toBe(1)
  await reportApplied(management, agentId, 2)
  expect(await applied()).toBe(2)
  await reportApplied(management, agentId, 1)
  expect(await applied()).toBe(2)
  await reportApplied(management, agentId, 3)
  expect(await applied()).toBe(3)
  await reportApplied(management, agentId, 3)
  expect(await applied()).toBe(3)
})
