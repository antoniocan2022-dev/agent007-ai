import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage<AbortSignal>()

export function getCeoCancellationSignal(): AbortSignal | undefined {
  return storage.getStore()
}

export function runWithCeoCancellationContext<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return storage.run(signal, work)
}
