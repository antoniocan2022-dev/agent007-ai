import { describe, expect, test } from 'bun:test'
import {
  hasFulfillmentCompleted,
  markFulfillmentCompleted,
  markFulfillmentPending,
  stripeIncomeReference,
} from './revenue-integrity'

describe('revenue integrity primitives', () => {
  test('creates stable sale and refund ledger references', () => {
    expect(stripeIncomeReference('sale', 'pi_123')).toBe('stripe:sale:pi_123')
    expect(stripeIncomeReference('refund', 'pi_123')).toBe('stripe:refund:pi_123')
  })

  test('tracks fulfillment completion without losing Stripe payload', () => {
    const source = JSON.stringify({ id: 'evt_123', data: { object: { metadata: { productId: '50-ai-tools-guide' } } } })
    const marked = markFulfillmentCompleted(source)

    expect(hasFulfillmentCompleted(source)).toBe(false)
    expect(hasFulfillmentCompleted(marked)).toBe(true)
    const parsed = JSON.parse(marked)
    expect(parsed.id).toBe('evt_123')
    expect(parsed.data.object.metadata.productId).toBe('50-ai-tools-guide')
  })

  test('records a retryable fulfillment state', () => {
    const marked = markFulfillmentPending(JSON.stringify({ id: 'evt_123' }), 'SMTP unavailable')
    const parsed = JSON.parse(marked)

    expect(parsed.__agent007.fulfillmentStatus).toBe('pending_retry')
    expect(parsed.__agent007.fulfillmentError).toBe('SMTP unavailable')
    expect(hasFulfillmentCompleted(marked)).toBe(false)
  })
})
