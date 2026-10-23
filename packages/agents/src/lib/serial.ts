/**
 * Ordering helpers for the work one object runs in memory.
 *
 * @module
 */

/** Run each operation after the previous one settles, whether it succeeded or failed. */
export function serialQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return (operation) => {
    const run = tail.then(operation, operation)
    tail = run.catch(() => undefined)
    return run
  }
}

/**
 * Run `work` without overlap: a start while it runs asks for one more run once it ends. Failures
 * are logged, since nothing awaits the run.
 */
export function coalescingRunner(
  work: () => Promise<void>,
  label: string,
): { start: () => void; running: () => boolean } {
  let current: Promise<void> | undefined
  let again = false
  const start = (): void => {
    if (current !== undefined) {
      again = true
      return
    }
    current = work()
      .catch((error: unknown) => console.error(label, error))
      .finally(() => {
        current = undefined
        if (!again) return
        again = false
        start()
      })
  }
  return { start, running: () => current !== undefined }
}
