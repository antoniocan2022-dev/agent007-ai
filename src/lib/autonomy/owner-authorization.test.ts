import { describe, expect, test } from 'bun:test'
import { classifyAutonomyAction } from './autonomy-policy'
import { isVerifiedOwnerAuthorization } from './owner-authorization'

describe('owner authorization boundary', () => {
  test('caller-provided approval booleans do not authorize sensitive execution', () => {
    const decision = classifyAutonomyAction({
      category: 'deployment',
      reversible: true,
      externalSideEffect: true,
      affectsProduction: true,
      affectsSecurity: false,
      affectsFinancialState: false,
      containsPersonalData: false,
      policyApproved: true,
      confidence: 1,
    })

    expect(decision.autonomous).toBe(false)
    expect(decision.authorizedForExecution).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('owner-shaped objects are not accepted as verified execution authority', () => {
    const ownerShapedData = {
      kind: 'owner-session',
      userId: 'owner',
      email: 'operator@example.com',
      verifiedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    } as never

    const decision = classifyAutonomyAction({
      category: 'write',
      reversible: true,
      externalSideEffect: false,
      affectsProduction: false,
      affectsSecurity: false,
      affectsFinancialState: false,
      containsPersonalData: false,
      policyApproved: false,
      confidence: 1,
      ownerAuthorization: ownerShapedData,
    })

    expect(decision.authority).toBe('HUMAN_APPROVAL')
    expect(decision.autonomous).toBe(false)
    expect(decision.authorizedForExecution).toBe(false)
    expect(decision.requiresOwnerApproval).toBe(true)
  })

  test('forbidden destructive actions stay blocked even with owner-shaped data', () => {
    const decision = classifyAutonomyAction({
      category: 'data_destructive',
      reversible: false,
      externalSideEffect: false,
      affectsProduction: true,
      affectsSecurity: true,
      affectsFinancialState: false,
      containsPersonalData: true,
      policyApproved: true,
      confidence: 1,
      ownerAuthorization: {
        kind: 'owner-session',
        userId: 'owner',
        email: 'operator@example.com',
        verifiedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      } as never,
    })

    expect(decision.authority).toBe('FORBIDDEN')
    expect(decision.authorizedForExecution).toBe(false)
  })

  test('arbitrary objects are never accepted as verified owner authorization', () => {
    expect(isVerifiedOwnerAuthorization({
      kind: 'owner-session',
      userId: 'owner',
      email: 'operator@example.com',
      verifiedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })).toBe(false)
  })
})
