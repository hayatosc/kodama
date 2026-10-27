/**
 * Serial operations run in order despite failures, and a coalescing runner never overlaps itself.
 *
 * @module
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coalescingRunner, serialQueue } from './serial.ts'

afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve = (): void => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('serialQueue', () => {
  it('starts each operation after the previous one settles, even when it failed', async () => {
    const serial = serialQueue()
    const order: string[] = []
    const gate = deferred()

    const first = serial(async () => {
      await gate.promise
      order.push('first')
      throw new Error('first failed')
    })
    const second = serial(async () => {
      order.push('second')
      return 2
    })
    gate.resolve()

    await expect(first).rejects.toThrow('first failed')
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first', 'second'])
  })
})

describe('coalescingRunner', () => {
  it('runs once more after the current run when started while running', async () => {
    const gates = [deferred(), deferred()]
    let runs = 0
    const runner = coalescingRunner(async () => {
      const gate = gates[runs]
      runs += 1
      await gate?.promise
    }, 'test')

    runner.start()
    runner.start()
    runner.start()
    expect(runner.running()).toBe(true)
    expect(runs).toBe(1)

    gates[0]?.resolve()
    await vi.waitFor(() => expect(runs).toBe(2))
    gates[1]?.resolve()
    await vi.waitFor(() => expect(runner.running()).toBe(false))
    expect(runs).toBe(2)
  })

  it('logs a failed run with its label and can start again', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    let runs = 0
    const runner = coalescingRunner(async () => {
      runs += 1
      throw new Error('boom')
    }, 'Runner failed')

    runner.start()
    await vi.waitFor(() => expect(runner.running()).toBe(false))
    runner.start()
    await vi.waitFor(() => expect(runs).toBe(2))

    expect(logged).toHaveBeenCalledWith('Runner failed', 'Error')
  })
})
