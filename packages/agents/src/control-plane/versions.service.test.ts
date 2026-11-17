/**
 * Applied-version reports cannot move backwards or exceed the desired registry version.
 *
 * @module
 */
import { expect, it } from 'vite-plus/test'
import { management, newAgentId } from '../testing/management.ts'
import { findAgentById } from './registry.repository.ts'
import { updateAgentVersions } from '../testing/test-db.repository.ts'
import { reportApplied } from './versions.service.ts'

it('accepts progress only up to the desired version', async () => {
  const agentId = await newAgentId()
  await updateAgentVersions(management, { agentId, currentVersion: 3, appliedVersion: 1 })
  const applied = async () => (await findAgentById(management, agentId))?.appliedVersion

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
