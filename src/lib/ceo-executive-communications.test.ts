import { describe, expect, test } from 'bun:test'
import { isCEOCommunicationSlot } from './ceo-executive-communications'

describe('CEO executive communication schedule', () => {
  test('accepts the morning slot in Toronto time', () => {
    expect(isCEOCommunicationSlot('morning', new Date('2026-08-11T09:00:00.000Z'))).toBe(true)
  })

  test('accepts the operations slot in Toronto time', () => {
    expect(isCEOCommunicationSlot('operations', new Date('2026-08-11T21:00:00.000Z'))).toBe(true)
  })

  test('accepts the investor slot on Saturday in Toronto time', () => {
    expect(isCEOCommunicationSlot('investor', new Date('2026-08-15T09:30:00.000Z'))).toBe(true)
  })

  test('rejects nearby non-slot invocations to prevent accidental delivery', () => {
    expect(isCEOCommunicationSlot('morning', new Date('2026-08-11T08:59:00.000Z'))).toBe(false)
    expect(isCEOCommunicationSlot('operations', new Date('2026-08-11T20:59:00.000Z'))).toBe(false)
    expect(isCEOCommunicationSlot('investor', new Date('2026-08-15T09:29:00.000Z'))).toBe(false)
  })
})
