import { describe, expect, test } from 'bun:test'
import { mapProviderErrorKindToCeoFailureReason, CEO_FAILURE_RETRYABLE } from '../src/lib/ceo-failure-reason'
import type { ProviderErrorKind } from '../src/lib/provider-control-plane'

describe('mapProviderErrorKindToCeoFailureReason: the Stage 4 provider-to-CEO bridge', () => {
  test('TIMEOUT maps to the exact matching CEO reason', () => {
    expect(mapProviderErrorKindToCeoFailureReason('TIMEOUT')).toBe('provider_timeout')
  })

  test('credential/quota/model-availability kinds all map to provider_unavailable', () => {
    const kinds: ProviderErrorKind[] = ['AUTHENTICATION', 'AUTHORIZATION', 'BILLING', 'RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_NOT_GOVERNED', 'CATALOG_UNAVAILABLE']
    for (const kind of kinds) expect(mapProviderErrorKindToCeoFailureReason(kind)).toBe('provider_unavailable')
  })

  test('request-shape problems map to invalid_request, not a provider failure -- a distinction the old message-regex fallback could not make', () => {
    expect(mapProviderErrorKindToCeoFailureReason('REQUEST_TOO_LARGE')).toBe('invalid_request')
    expect(mapProviderErrorKindToCeoFailureReason('INVALID_REQUEST')).toBe('invalid_request')
  })

  test('generic/transient infrastructure kinds map to provider_error', () => {
    expect(mapProviderErrorKindToCeoFailureReason('NETWORK')).toBe('provider_error')
    expect(mapProviderErrorKindToCeoFailureReason('UPSTREAM')).toBe('provider_error')
    expect(mapProviderErrorKindToCeoFailureReason('UNKNOWN')).toBe('provider_error')
  })

  test('every mapped reason is itself a real, retryable-classified CeoFailureReason', () => {
    const allKinds: ProviderErrorKind[] = ['AUTHENTICATION', 'AUTHORIZATION', 'BILLING', 'RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_NOT_GOVERNED', 'CATALOG_UNAVAILABLE', 'TIMEOUT', 'NETWORK', 'INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'UPSTREAM', 'UNKNOWN']
    for (const kind of allKinds) {
      const reason = mapProviderErrorKindToCeoFailureReason(kind)
      expect(typeof CEO_FAILURE_RETRYABLE[reason]).toBe('boolean')
    }
  })
})
