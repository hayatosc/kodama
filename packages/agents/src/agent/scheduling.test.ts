/** Reservation tools and alarms through real RPC, Pi execution and SQLite persistence. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { withHarness } from '../testing/harness.ts'
import { dispatchSchedules, mutateSchedule } from './scheduling.ts'
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import {
  scheduledTasks,
  scheduledTaskOccurrences,
  usage,
} from '../../drizzle/durable-object/schema.ts'
import { management, newAgentId, updateSettings } from '../testing/management.ts'
import { agents, credentialGrants } from '../../drizzle/management/schema.ts'
import { useMockModel, waitForAnswer } from '../testing/rpc.ts'
import { requestBody, textResponse, toolCallResponse } from '../testing/model.ts'
import { openLocalDb } from './local-db/local.ts'
import { listReservations, insertReservation, claimOccurrence } from './local-db/scheduled-tasks.ts'
import { isKnownUrl, markContact } from './local-db/external-data.ts'
import { setAlarm } from './runtime/alarms.ts'
import { uuidv7 } from '../lib/uuid.ts'
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

async function enabled() {
  const id = await newAgentId()
  await updateSettings(id, {
    tools: ['schedule_task', 'list_scheduled_tasks', 'cancel_scheduled_task'],
    memoryPolicy: { remember: true, extract: false },
  })
  return id
}

async function rows(id: string) {
  return runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) =>
    listReservations(await openLocalDb(state.storage)),
  )
}

async function due(id: string, recurring = false) {
  return runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    const start = Date.now() - 3_600_000
    const task = insertReservation(
      local,
      {
        sourceTask: crypto.randomUUID(),
        sourceEntry: 1,
        arguments: '{}',
        instruction: 'Read https://example.org/scheduled-only',
        rule: recurring ? { kind: 'interval', start, every: 60_000 } : { kind: 'once', start },
        nextDue: start,
      },
      start - 1000,
    )
    await setAlarm(state.storage, 'schedule', Date.now() + 60_000)
    return task
  })
}

async function wake(id: string) {
  await runInDurableObject(env.AGENTS.getByName(id), async (instance, state) => {
    await setAlarm(state.storage, 'schedule', Date.now() - 1)
    await instance.alarm()
  })
}

describe('agent-managed reservations', () => {
  it('creates, lists and cancels through actual model tools even with legacy contact metadata', async () => {
    const id = await enabled()
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      markContact(local, String(ROOT_CONVERSATION_ID), 'legacy', 0)
    })
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'schedule_task',
        arguments: {
          schedule: { kind: 'interval', every_seconds: 3600 },
          instruction: 'Summarize updates',
        },
      }),
    )
    await exports.default.sendMessage(id, {
      requestId: 'create',
      content: 'Every hour, summarize updates.',
    })
    await waitForAnswer(id, 'create')
    const task = (await rows(id)).tasks[0]
    expect(task).toMatchObject({ state: 'active', instruction: 'Summarize updates' })
    if (!task) throw new Error('Missing reservation')
    await evictDurableObject(env.AGENTS.getByName(id))
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({ name: 'list_scheduled_tasks', arguments: {} }),
      )
      .mockImplementationOnce(async (_input, init) => {
        expect(requestBody(init)).toContain(task.taskId)
        return textResponse('Listed')
      })
    await exports.default.sendMessage(id, { requestId: 'list', content: 'List reservations.' })
    await waitForAnswer(id, 'list')
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({ name: 'cancel_scheduled_task', arguments: { task_id: task.taskId } }),
    )
    await exports.default.sendMessage(id, { requestId: 'cancel', content: 'Cancel it.' })
    await waitForAnswer(id, 'cancel')
    expect((await rows(id)).tasks[0]?.state).toBe('cancelled')
  })

  it('rejects peer creation, but a later owner-only run may create', async () => {
    const id = await enabled()
    const call = {
      name: 'schedule_task',
      arguments: { schedule: { kind: 'interval', every_seconds: 3600 }, instruction: 'Work' },
    }
    vi.mocked(fetch)
      .mockImplementationOnce(async () => toolCallResponse(call))
      .mockImplementationOnce(async (_input, init) => {
        expect(requestBody(init)).toContain('schedule_owner_required')
        return textResponse('Refused')
      })
    await env.AGENTS.getByName(uuidv7()).sendTo(id, {
      requestId: 'peer',
      content: 'Schedule something',
    })
    await waitForAnswer(id, 'peer')
    expect((await rows(id)).tasks).toHaveLength(0)
    vi.mocked(fetch).mockImplementationOnce(async () => toolCallResponse(call))
    await exports.default.sendMessage(id, { requestId: 'owner', content: 'Schedule something' })
    await waitForAnswer(id, 'owner')
    expect((await rows(id)).tasks).toHaveLength(1)
  })
})

it.each(['kodama.agent-message', 'kodama.scheduled-message'])(
  'rejects owner input mixed with %s in the adopted run',
  async (kind) => {
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const adopted = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    vi.mocked(fetch)
      .mockImplementationOnce(async () => {
        started.resolve()
        await release.promise
        return textResponse('First')
      })
      .mockImplementationOnce(async () => {
        adopted.resolve()
        await finish.promise
        return textResponse('Mixed')
      })
    await withHarness({ steeringMode: 'all', followUpMode: 'all' }, async (harness, state) => {
      const root = await harness.root(BACKGROUND_CONTEXT)
      try {
        await root.submit({ type: 'input', content: 'First' }, BACKGROUND_CONTEXT)
        await started.promise
        const owner = await root.submit(
          { type: 'input', content: 'Owner', whenBusy: 'steer' },
          BACKGROUND_CONTEXT,
        )
        const external = await root.submit(
          {
            type: 'input',
            content: 'Not owner',
            whenBusy: 'followUp',
            entry: { kind, data: { hop: 0 } },
          },
          BACKGROUND_CONTEXT,
        )
        release.resolve()
        await adopted.promise
        const live = await harness.snapshot(LiveDoc, ROOT_CONVERSATION_ID, BACKGROUND_CONTEXT)
        if (!live?.run) throw new Error('Missing adopted run')
        expect(live.run.inputs).toHaveLength(2)
        await expect(
          mutateSchedule(
            await openLocalDb(state.storage),
            harness,
            {
              operation: 'create',
              schedule: { kind: 'interval', every_seconds: 60 },
              instruction: 'Forbidden',
            },
            { taskId: live.run.taskId, conversationId: ROOT_CONVERSATION_ID },
            BACKGROUND_CONTEXT,
            () => {},
          ),
        ).rejects.toThrow('schedule_owner_required')
        finish.resolve()
        await owner.wait(BACKGROUND_CONTEXT)
        await external.wait(BACKGROUND_CONTEXT)
      } finally {
        release.resolve()
        finish.resolve()
      }
    })
  },
)

describe('scheduled dispatch and receipts', () => {
  it.each(['credentials', 'registry'] as const)(
    'immediately refuses a never-admitted occurrence after %s access is removed',
    async (reason) => {
      const id = await enabled()
      await due(id)
      if (reason === 'credentials')
        await management.delete(credentialGrants).where(eq(credentialGrants.agentId, id))
      else await management.update(agents).set({ status: 'archived' }).where(eq(agents.agentId, id))
      await wake(id)
      expect((await rows(id)).tasks[0]).toMatchObject({
        state: 'failed',
        latest: {
          state: 'failed',
          admissionStarted: false,
          attempts: 0,
          outcome: 'admission_refused',
        },
      })
      expect(vi.mocked(fetch).mock.calls).toHaveLength(0)
    },
  )

  it.each([
    'credential_unavailable: credential is busy',
    'credential_unavailable: OAuth refresh temporarily unavailable',
    'credential_unavailable: OAuth refresh request failed',
  ])('keeps transient preparation failure retryable: %s', async (message) => {
    await withHarness({}, async (harness, state) => {
      const local = await openLocalDb(state.storage)
      const start = Date.now() - 1000
      insertReservation(
        local,
        {
          sourceTask: 'transient-prepare',
          sourceEntry: 1,
          arguments: '{}',
          instruction: 'Retry later',
          rule: { kind: 'once', start },
          nextDue: start,
        },
        start - 1,
      )
      const admit = vi.fn(async () => {})
      await dispatchSchedules(
        local,
        harness,
        state.storage,
        (operation) => operation(),
        async () => {
          throw new Error(message)
        },
        admit,
      )
      expect(listReservations(local).tasks[0]).toMatchObject({
        state: 'active',
        latest: { state: 'dispatching', admissionStarted: false, attempts: 1, outcome: null },
      })
      expect(admit).not.toHaveBeenCalled()
    })
  })

  it('keeps uncertain admission recoverable after a later permanent refusal', async () => {
    const id = await enabled()
    const task = await due(id)
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      claimOccurrence(local, task, task.rule.start, undefined, Date.now() - 1000)
      local.update(scheduledTaskOccurrences).set({ admissionStarted: true, attempts: 5 }).run()
    })
    await updateSettings(id, { tools: [] })
    await wake(id)
    expect((await rows(id)).tasks[0]).toMatchObject({
      state: 'active',
      latest: { state: 'dispatching', admissionStarted: true, attempts: 6 },
    })
    expect(vi.mocked(fetch).mock.calls).toHaveLength(0)
  })
  it('survives eviction, runs once as system without granting URLs, and does not replay on another wake', async () => {
    const id = await enabled()
    const task = await due(id)
    await evictDurableObject(env.AGENTS.getByName(id))
    await wake(id)
    const request = `scheduled-${task.id}-${task.rule.start}`
    await waitForAnswer(id, request)
    await expect.poll(async () => (await rows(id)).tasks[0]?.latest?.outcome).toBe('done')
    await wake(id)
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      expect(
        isKnownUrl(local, String(ROOT_CONVERSATION_ID), 'https://example.org/scheduled-only'),
      ).toBe(false)
      expect(
        local
          .select()
          .from(usage)
          .all()
          .map((row) => row.actorKind),
      ).toEqual(['system'])
      expect(local.select().from(scheduledTaskOccurrences).all()).toHaveLength(1)
    })
  })

  it('coalesces missed intervals and does not overlap an unfinished execution', async () => {
    const id = await enabled()
    await due(id, true)
    const started = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started.resolve()
      return response.promise
    })
    try {
      await wake(id)
      await started.promise
      await wake(id)
      const task = (await rows(id)).tasks[0]
      expect(task?.latest?.state).toBe('submitted')
      expect(task?.latest?.coalescedFrom).toBeLessThan(task?.latest?.nominalAt ?? 0)
      expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    } finally {
      response.resolve(textResponse('Finished'))
    }
    await expect.poll(async () => (await rows(id)).tasks[0]?.latest?.outcome).toBe('done')
    expect((await rows(id)).tasks[0]?.state).toBe('active')
  })

  it('recovers acceptance before applying a newly disabled tool policy', async () => {
    const id = await enabled()
    const task = await due(id)
    await wake(id)
    await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)
    await expect.poll(async () => (await rows(id)).tasks[0]?.latest?.outcome).toBe('done')
    // Simulate a crash after Pi committed acceptance but before the domain receipt persisted.
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      local
        .update(scheduledTaskOccurrences)
        .set({
          state: 'dispatching',
          submissionId: null,
          settledAt: null,
          outcome: null,
          retryAt: Date.now() - 1000,
        })
        .run()
      local.update(scheduledTasks).set({ state: 'active' }).run()
    })
    await updateSettings(id, { tools: [] })
    await wake(id)
    expect((await rows(id)).tasks[0]?.latest?.outcome).toBe('done')
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
  })

  it('refuses future admission when disabled and does not create recursive reservations', async () => {
    const disabled = await enabled()
    await due(disabled)
    await updateSettings(disabled, { tools: [] })
    await wake(disabled)
    expect((await rows(disabled)).tasks[0]).toMatchObject({
      state: 'failed',
      latest: { outcome: 'admission_refused' },
    })
    const id = await enabled()
    const task = await due(id)
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'schedule_task',
          arguments: {
            schedule: { kind: 'interval', every_seconds: 60 },
            instruction: 'Recursive',
          },
        }),
      )
      .mockImplementationOnce(async (_input, init) => {
        expect(requestBody(init)).toContain('schedule_owner_required')
        return textResponse('Refused')
      })
    await wake(id)
    await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)
    expect((await rows(id)).tasks).toHaveLength(1)
  })

  it('retries a claimed but never submitted occurrence after eviction using its original ID', async () => {
    const id = await enabled()
    const task = await due(id)
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      claimOccurrence(local, task, task.rule.start, undefined, Date.now() - 1000)
    })
    await evictDurableObject(env.AGENTS.getByName(id))
    await wake(id)
    await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)
    await expect.poll(async () => (await rows(id)).tasks[0]?.latest?.outcome).toBe('done')
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      expect(
        local
          .select()
          .from(scheduledTaskOccurrences)
          .where(eq(scheduledTaskOccurrences.taskId, task.id))
          .all(),
      ).toHaveLength(1)
    })
  })
})
