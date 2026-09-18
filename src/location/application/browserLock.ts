// Web Locks coordinates same-origin tabs; the promise queue also covers StrictMode
// and environments without Web Locks. Different origins remain independent.
let queue: Promise<unknown> = Promise.resolve()

export function withPresenceLock<T>(action: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => navigator.locks
    ? await navigator.locks.request('kavozi-presence-lifecycle', action)
    : action()
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}
