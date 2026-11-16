/** Reservation tools and alarms through real RPC, Pi execution and SQLite persistence. @module */
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import { LiveDoc, ROOT_CONVERSATION_ID } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { withHarness } from '../testing/harness.ts'
import { dispatchSchedules, mutateSchedule, rearmScheduling } from './scheduling.ts'
import { recordNotification } from './local-db/notifications.ts'
import { EXTENSION_RETENTION_MS } from '../extensions.ts'
import { describe, expect, it, vi } from 'vite-plus/test'
import { management, newAgentId, updateSettings } from '../testing/management.ts'
import { useMockModel, waitForAnswer } from '../testing/rpc.ts'
import { requestBody, textResponse, toolCallResponse } from '../testing/model.ts'
import { openLocalDb } from './local-db/local.ts'
import { listReservations, insertReservation, claimOccurrence } from './local-db/scheduled-tasks.ts'
import { isKnownUrl, markContact } from './local-db/external-data.ts'
import { setAlarm } from './runtime/alarms.ts'
import { createScheduleTools } from '../tools/scheduled-tasks.ts'
import { uuidv7 } from '../lib/uuid.ts'
import deleteCredentialGrantsByAgent from '../testing/sql/delete-credential-grants-by-agent.sql'
import resetScheduledOccurrencesDispatching from '../testing/sql/reset-scheduled-occurrences-dispatching.sql'
import selectAllNotifications from '../testing/sql/select-all-notifications.sql'
import selectAllScheduledOccurrences from '../testing/sql/select-all-scheduled-occurrences.sql'
import selectAllUsage from '../testing/sql/select-all-usage.sql'
import selectScheduledOccurrencesByTask from '../testing/sql/select-scheduled-occurrences-by-task.sql'
import setAgentStatus from '../testing/sql/set-agent-status.sql'
import setAllScheduledTasksState from '../testing/sql/set-all-scheduled-tasks-state.sql'
import setNotificationsExpiresAt from '../testing/sql/set-notifications-expires-at.sql'
import setScheduledOccurrencesAdmissionAttempts from '../testing/sql/set-scheduled-occurrences-admission-attempts.sql'
import setScheduledOccurrencesAttemptsRetry from '../testing/sql/set-scheduled-occurrences-attempts-retry.sql'
import setScheduledOccurrencesRetryAt from '../testing/sql/set-scheduled-occurrences-retry-at.sql'
import setScheduledTaskHop from '../testing/sql/set-scheduled-task-hop.sql'
import setScheduledTaskHopAndRule from '../testing/sql/set-scheduled-task-hop-and-rule.sql'
import '@earendil-works/pi-ai/api/openai-responses'

useMockModel()

async function enabled() {
  const id = await newAgentId()
  await updateSettings(id, {
    tools: [
      'schedule_task',
      'list_scheduled_tasks',
      'update_scheduled_task',
      'cancel_scheduled_task',
      'send_outbox',
    ],
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

it('uses the existing schedule alarm for idle inbox retention without waking the model', async () => {
  const id = await enabled()
  await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    const now = Date.now()
    recordNotification(
      local,
      {
        source: 'contact',
        sourceId: 'retention',
        outcome: 'succeeded',
        summary: 'Completed.',
        artifactIds: [],
      },
      now,
    )
    await rearmScheduling(local, state.storage)
    expect(await state.storage.get('kodama:alarm:schedule')).toBe(now + EXTENSION_RETENTION_MS)
    setNotificationsExpiresAt.runSync(local.sql, { expiresAt: now - 1 })
  })
  await wake(id)
  await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
    const local = await openLocalDb(state.storage)
    expect(selectAllNotifications.runSync(local.sql)).toEqual([])
    expect(await state.storage.get('kodama:alarm:schedule')).toBeUndefined()
  })
  expect(fetch).not.toHaveBeenCalled()
})

it('notifies model failure with a fixed summary and leaves a recurring definition active', async () => {
  const id = await enabled()
  await due(id, true)
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: { message: 'private provider detail', type: 'invalid_request_error' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ),
  )
  await wake(id)
  await expect
    .poll(async () => (await exports.default.notifications(id)).notifications[0]?.outcome)
    .toBe('failed')
  expect((await rows(id)).tasks[0]?.state).toBe('active')
  const inbox = await exports.default.notifications(id)
  expect(JSON.stringify(inbox)).not.toContain('private provider detail')
  expect(inbox.notifications).toHaveLength(1)
  await wake(id)
  expect((await exports.default.notifications(id)).notifications).toHaveLength(1)
})

it('global cancellation notifies the execution once but preserves future reservations', async () => {
  const id = await enabled()
  await due(id, true)
  const started = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<Response>()
  vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
    started.resolve()
    if (init?.signal) {
      const signal = init.signal
      return Promise.race([
        finish.promise,
        new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
      ])
    }
    return finish.promise
  })
  try {
    await wake(id)
    await started.promise
    expect((await exports.default.notifications(id)).notifications).toEqual([])
    await exports.default.cancel(id)
    await expect
      .poll(async () => (await exports.default.notifications(id)).notifications[0]?.outcome)
      .toBe('cancelled')
    expect((await rows(id)).tasks[0]?.state).toBe('active')
    await wake(id)
    expect((await exports.default.notifications(id)).notifications).toHaveLength(1)
  } finally {
    finish.resolve(textResponse('Late answer'))
  }
})

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
    expect((await exports.default.notifications(id)).notifications).toEqual([])
  })

  it('rejects peer recurring creation, but a later owner-only run may create', async () => {
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
        await deleteCredentialGrantsByAgent.run(management, { agentId: id })
      else await setAgentStatus.run(management, { agentId: id, status: 'archived' })
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
      expect(selectAllNotifications.runSync(local.sql)).toEqual([])
      // Exhaust confirmed pre-admission failures; only the final transition produces a notice.
      setScheduledOccurrencesAttemptsRetry.runSync(local.sql, {
        attempts: 4,
        retryAt: Date.now() - 1,
      })
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
      expect(listReservations(local).tasks[0]?.latest?.outcome).toBe('admission_retry_exhausted')
      expect(selectAllNotifications.runSync(local.sql)).toMatchObject([{ outcome: 'failed' }])
    })
  })

  it('keeps uncertain admission recoverable after a later permanent refusal', async () => {
    const id = await enabled()
    const task = await due(id)
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      claimOccurrence(local, task, task.rule.start, undefined, Date.now() - 1000)
      setScheduledOccurrencesAdmissionAttempts.runSync(local.sql, {
        admissionStarted: true,
        attempts: 5,
      })
    })
    await updateSettings(id, { tools: [] })
    await wake(id)
    expect((await rows(id)).tasks[0]).toMatchObject({
      state: 'active',
      latest: { state: 'dispatching', admissionStarted: true, attempts: 6 },
    })
    expect(vi.mocked(fetch).mock.calls).toHaveLength(0)
    expect((await exports.default.notifications(id)).notifications).toEqual([])
  })
  it('survives eviction, finishes silently by default without granting URLs, and does not replay on another wake', async () => {
    const id = await enabled()
    const task = await due(id)
    await evictDurableObject(env.AGENTS.getByName(id))
    await wake(id)
    const request = `scheduled-${task.id}-${task.rule.start}`
    await waitForAnswer(id, request)
    await expect.poll(async () => (await rows(id)).tasks[0]?.latest?.outcome).toBe('done')
    await wake(id)
    const inbox = await exports.default.notifications(id)
    expect(inbox.notifications).toEqual([])
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1)
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      expect(
        isKnownUrl(local, String(ROOT_CONVERSATION_ID), 'https://example.org/scheduled-only'),
      ).toBe(false)
      expect(selectAllUsage.runSync(local.sql).map((row) => row.actorKind)).toEqual(['system'])
      expect(selectAllScheduledOccurrences.runSync(local.sql)).toHaveLength(1)
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
      resetScheduledOccurrencesDispatching.runSync(local.sql, { retryAt: Date.now() - 1000 })
      setAllScheduledTasksState.runSync(local.sql, { state: 'active' })
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
    expect((await exports.default.notifications(disabled)).notifications).toMatchObject([
      { outcome: 'failed', summary: 'Scheduled execution failed.' },
    ])
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
      expect(selectScheduledOccurrencesByTask.runSync(local.sql, { taskId: task.id })).toHaveLength(
        1,
      )
    })
  })

  it('supports pausing, resuming, and editing schedules and session_mode via update_scheduled_task', async () => {
    expect(
      createScheduleTools().find((tool) => tool.name === 'update_scheduled_task')?.replay,
    ).toBe('unsafe')

    const id = await enabled()
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'schedule_task',
        arguments: {
          schedule: { kind: 'interval', every_seconds: 3600 },
          instruction: 'Initial check',
        },
      }),
    )
    await exports.default.sendMessage(id, { requestId: 'create-upd', content: 'Schedule check.' })
    await waitForAnswer(id, 'create-upd')
    const created = (await rows(id)).tasks[0]
    if (!created) throw new Error('Missing task')
    expect(created.sessionMode).toBe('new')

    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'update_scheduled_task',
        arguments: { task_id: created.taskId, action: 'pause' },
      }),
    )
    await exports.default.sendMessage(id, { requestId: 'pause-upd', content: 'Pause it.' })
    await waitForAnswer(id, 'pause-upd')
    expect((await rows(id)).tasks[0]?.state).toBe('paused')

    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'update_scheduled_task',
        arguments: {
          task_id: created.taskId,
          action: 'resume',
          instruction: 'Updated check',
        },
      }),
    )
    await exports.default.sendMessage(id, { requestId: 'resume-upd', content: 'Resume and edit.' })
    await waitForAnswer(id, 'resume-upd')
    expect((await rows(id)).tasks[0]).toMatchObject({
      state: 'active',
      instruction: 'Updated check',
    })

    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'update_scheduled_task',
        arguments: { task_id: created.taskId, session_mode: 'resume' },
      }),
    )
    await exports.default.sendMessage(id, {
      requestId: 'mode-upd',
      content: 'Switch session mode to resume.',
    })
    await waitForAnswer(id, 'mode-upd')
    expect((await rows(id)).tasks[0]?.sessionMode).toBe('resume')
  })

  it('allows autonomous one-time follow-ups up to the hop limit and sends alerts only via send_outbox', async () => {
    const id = await enabled()
    const task = await due(id)
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'schedule_task',
          arguments: {
            schedule: { kind: 'once', delay_seconds: 120 },
            instruction: 'Poll build status again',
          },
        }),
      )
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'send_outbox',
          arguments: {
            summary: 'Deploy alert',
            details: 'Build #42 failed smoke test',
          },
        }),
      )
    await wake(id)
    await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)
    const all = (await rows(id)).tasks
    const followup = all.find((t) => t.taskId !== task.id)
    expect(followup).toMatchObject({
      category: 'followup',
      followupHop: 1,
      sessionMode: 'resume',
      state: 'active',
    })
    const inbox = await exports.default.notifications(id)
    expect(inbox.notifications).toMatchObject([
      {
        source: 'outbox',
        outcome: 'succeeded',
        summary: 'Deploy alert',
        details: 'Build #42 failed smoke test',
      },
    ])

    // Hop 5 execution can edit instruction on a follow-up, but cannot schedule or reschedule to hop 6.
    if (!followup) throw new Error('Missing follow-up task')
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      const past = Date.now() - 1000
      setScheduledTaskHopAndRule.runSync(local.sql, {
        id: followup.taskId,
        followupHop: 5,
        rule: JSON.stringify({ kind: 'once', start: past }),
        nextDue: past,
      })
    })
    let observedCreateReject = ''
    let observedUpdateReject = ''
    vi.mocked(fetch)
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'update_scheduled_task',
          arguments: {
            task_id: followup.taskId,
            instruction: 'Updated instruction at hop 5',
          },
        }),
      )
      .mockImplementationOnce(async () =>
        toolCallResponse({
          name: 'schedule_task',
          arguments: {
            schedule: { kind: 'once', delay_seconds: 120 },
            instruction: 'Hop 6',
          },
        }),
      )
      .mockImplementationOnce(async (_input, init) => {
        observedCreateReject = requestBody(init)
        return toolCallResponse({
          name: 'update_scheduled_task',
          arguments: {
            task_id: followup.taskId,
            schedule: { kind: 'once', delay_seconds: 120 },
          },
        })
      })
      .mockImplementationOnce(async (_input, init) => {
        observedUpdateReject = requestBody(init)
        return textResponse('Limit reached')
      })
    await wake(id)
    await expect
      .poll(
        async () =>
          (await rows(id)).tasks.find((t) => t.taskId === followup.taskId)?.latest?.outcome,
      )
      .toBe('done')
    expect(observedCreateReject).toContain('schedule_followup_limit')
    expect(observedUpdateReject).toContain('schedule_followup_limit')
    const afterHop5 = (await rows(id)).tasks
    expect(afterHop5).toHaveLength(2)
    expect(afterHop5.find((t) => t.taskId === followup.taskId)).toMatchObject({
      instruction: 'Updated instruction at hop 5',
      followupHop: 5,
    })
  })

  it('advances followupHop when an autonomous run reschedules a follow-up', async () => {
    const id = await enabled()
    const task = await due(id)
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'schedule_task',
        arguments: {
          schedule: { kind: 'once', delay_seconds: 120 },
          instruction: 'Follow-up timer',
        },
      }),
    )
    await wake(id)
    await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)
    const followup = (await rows(id)).tasks.find((t) => t.taskId !== task.id)
    if (!followup) throw new Error('Missing follow-up task')

    const secondTask = await due(id)
    await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
      const local = await openLocalDb(state.storage)
      setScheduledTaskHop.runSync(local.sql, {
        id: secondTask.id,
        followupHop: 2,
      })
    })
    vi.mocked(fetch).mockImplementationOnce(async () =>
      toolCallResponse({
        name: 'update_scheduled_task',
        arguments: {
          task_id: followup.taskId,
          schedule: { kind: 'once', delay_seconds: 300 },
        },
      }),
    )
    await wake(id)
    await waitForAnswer(id, `scheduled-${secondTask.id}-${secondTask.rule.start}`)
    expect((await rows(id)).tasks.find((t) => t.taskId === followup.taskId)?.followupHop).toBe(3)
  })

  it('isolates session_mode new scheduled turns via root.reset() without breaking prior history', async () => {
    const id = await enabled()
    vi.mocked(fetch).mockImplementationOnce(async () => textResponse('Remembered prior-secret-99.'))
    await exports.default.sendMessage(id, {
      requestId: 'prior-msg',
      content: 'User fact prior-secret-99.',
    })
    await waitForAnswer(id, 'prior-msg')

    const task = await due(id)
    let observedBody = ''
    vi.mocked(fetch).mockImplementationOnce(async (_input, init) => {
      observedBody = requestBody(init)
      return textResponse('Fresh scheduled check complete.')
    })

    await wake(id)
    await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)
    expect(observedBody).toContain('Read https://example.org/scheduled-only')
    expect(observedBody).not.toContain('prior-secret-99')
    await runInDurableObject(env.AGENTS.getByName(id), async (instance) => {
      const page = await instance.readEntries({ after: 0, limit: 50 })
      expect(page.entries.map((e) => e.text).join('\n')).toContain('prior-secret-99')
    })
  })

  it('defers session_mode new scheduled dispatch while a turn is active and runs isolated after it finishes', async () => {
    const id = await enabled()
    const started = Promise.withResolvers<void>()
    const finishSlow = Promise.withResolvers<Response>()
    let observedScheduledBody = ''

    vi.mocked(fetch)
      .mockImplementationOnce(async () => {
        started.resolve()
        return finishSlow.promise
      })
      .mockImplementationOnce(async (_input, init) => {
        observedScheduledBody = requestBody(init)
        return textResponse('Isolated scheduled run complete.')
      })

    try {
      await exports.default.sendMessage(id, {
        requestId: 'active-operator-turn',
        content: 'Active secret active-secret-77.',
      })
      await started.promise

      const task = await due(id)
      await wake(id)

      // Busy session must defer without cancelling the active turn or resetting mid-turn.
      expect((await rows(id)).tasks[0]?.latest).toMatchObject({
        state: 'dispatching',
        attempts: 0,
      })
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

      finishSlow.resolve(textResponse('Operator turn finished.'))
      await waitForAnswer(id, 'active-operator-turn')

      await runInDurableObject(env.AGENTS.getByName(id), async (_instance, state) => {
        const local = await openLocalDb(state.storage)
        setScheduledOccurrencesRetryAt.runSync(local.sql, {
          retryAt: Date.now() - 1,
        })
      })
      await wake(id)
      await waitForAnswer(id, `scheduled-${task.id}-${task.rule.start}`)

      expect(observedScheduledBody).toContain('Read https://example.org/scheduled-only')
      expect(observedScheduledBody).not.toContain('active-secret-77')
    } finally {
      finishSlow.resolve(textResponse('Cleanup'))
    }
  })
})
