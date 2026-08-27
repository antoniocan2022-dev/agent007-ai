import { AsyncLocalStorage } from 'node:async_hooks'
import type { OrchestrationOwner } from './ceo-cognitive-contract'

const ownerStorage = new AsyncLocalStorage<OrchestrationOwner>()

/**
 * Run work under one authoritative orchestration owner.
 * The scope is request-local, so concurrent Vercel invocations cannot leak
 * ownership into each other.
 */
export function withOrchestrationOwner<T>(owner: OrchestrationOwner, work: () => Promise<T>): Promise<T> {
  return ownerStorage.run(owner, work)
}

export function getOrchestrationOwner(): OrchestrationOwner | null {
  return ownerStorage.getStore() ?? null
}
