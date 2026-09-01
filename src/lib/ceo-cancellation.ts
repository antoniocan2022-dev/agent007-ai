export const CEO_REQUEST_ABORTED_CODE = 'CEO_REQUEST_ABORTED'

export class CeoRequestAbortedError extends Error {
  readonly code = CEO_REQUEST_ABORTED_CODE
  readonly reason: unknown

  constructor(reason?: unknown) {
    super('Agent007 request was cancelled before completion.')
    this.name = 'CeoRequestAbortedError'
    this.reason = reason
  }
}

export function isCeoRequestAborted(error: unknown): boolean {
  return error instanceof CeoRequestAbortedError || (error instanceof Error && error.name === 'AbortError')
}

export function throwIfCeoRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CeoRequestAbortedError(signal.reason)
}
