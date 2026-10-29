/** Cancellable deadlines whose timers never keep completed calls alive. @module */

/** Dispose at the end of the operation, including errors and parent cancellation. */
export function deadline(
  milliseconds: number,
  parent?: AbortSignal,
): Disposable & { signal: AbortSignal } {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')),
    milliseconds,
  )
  return {
    signal: parent ? AbortSignal.any([parent, controller.signal]) : controller.signal,
    [Symbol.dispose]() {
      clearTimeout(timer)
    },
  }
}
