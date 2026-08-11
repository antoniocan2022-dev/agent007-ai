type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function parseJson(value: string): JsonRecord {
  try { return asRecord(JSON.parse(value)) } catch { return {} }
}

export function stripeIncomeReference(kind: 'sale' | 'refund', providerTxId: string): string {
  return `stripe:${kind}:${providerTxId}`
}

export function hasFulfillmentCompleted(rawPayload: string): boolean {
  const payload = parseJson(rawPayload)
  return asRecord(payload.__agent007).fulfillmentStatus === 'completed'
}

export function markFulfillmentCompleted(rawPayload: string): string {
  const payload = parseJson(rawPayload)
  payload.__agent007 = { ...asRecord(payload.__agent007), fulfillmentStatus: 'completed', fulfillmentMarkedAt: new Date().toISOString() }
  return JSON.stringify(payload)
}

export function markFulfillmentPending(rawPayload: string, error?: string): string {
  const payload = parseJson(rawPayload)
  const previous = asRecord(payload.__agent007)
  payload.__agent007 = {
    ...previous,
    fulfillmentStatus: 'pending_retry',
    ...(error ? { fulfillmentError: error.slice(0, 300) } : {}),
  }
  return JSON.stringify(payload)
}
