import { describe, expect, it, beforeEach } from 'bun:test'
import { ensureCommercialTenant } from './commercial-control-plane'
import {
  validatePhase6Invariants,
  validateCommercialProviderRegistry,
  resetCommercialProviderRegistryForTests,
  registerCommercialProviderAdapter,
  registerCommercialCredential,
  transitionCommercialCredential,
  registerDelegatedCommercialAuthority,
  submitCommercialExternalAction,
  runCommercialExternalAction,
  processCommercialWebhook,
  signPhase6Webhook,
  verifyPhase6WebhookSignature,
  getPhase6Execution,
  getPhase6ProviderObservations,
  type CommercialProviderAdapter,
} from './phase6-commercial-execution'
import { resendCommercialProviderAdapter } from './phase6-resend-adapter'

const unique = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const tenantFor = (p: string) => ensureCommercialTenant(unique(p), 'Phase 6 Test Portfolio')

beforeEach(() => resetCommercialProviderRegistryForTests())

describe('Phase 6 contracts', () => {
  it('keeps the invariant and provider registries clean', () => {
    expect(validatePhase6Invariants()).toEqual([])
    expect(validateCommercialProviderRegistry()).toEqual([])
  })

  it('rejects duplicate provider ids', () => {
    registerCommercialProviderAdapter(resendCommercialProviderAdapter)
    expect(() => registerCommercialProviderAdapter(resendCommercialProviderAdapter)).toThrow('already registered')
  })
})

describe('authorization and execution', () => {
  it('requires delegated authority', async () => {
    registerCommercialProviderAdapter(resendCommercialProviderAdapter)
    const tenant = await tenantFor('deny')
    const credential = await registerCommercialCredential({ tenantId: tenant.tenantId, business: 'revenue-recovery', provider: 'resend', externalAccountId: 'acct-deny', scopes: ['emails'], secretRef: 'env:RESEND_API_KEY' })
    await transitionCommercialCredential(credential.credentialId, tenant.tenantId, 'connected')
    await expect(submitCommercialExternalAction({ tenantId: tenant.tenantId, business: 'revenue-recovery', provider: 'resend', action: 'send_email', actor: 'revenue_recovery_leader', credentialId: credential.credentialId, idempotencyKey: unique('denied'), mode: 'sandbox', channel: 'email', input: { to: ['test@example.com'], subject: 'Denied', html: '<p>Denied</p>', from: 'Agent007 <noreply@example.com>' } })).rejects.toThrow('External action denied')
  })

  it('runs a sandbox action and preserves idempotency', async () => {
    registerCommercialProviderAdapter(resendCommercialProviderAdapter)
    const tenant = await tenantFor('sandbox')
    const credential = await registerCommercialCredential({ tenantId: tenant.tenantId, business: 'revenue-recovery', provider: 'resend', externalAccountId: 'acct-sandbox', scopes: ['emails'], secretRef: 'env:RESEND_API_KEY' })
    await transitionCommercialCredential(credential.credentialId, tenant.tenantId, 'connected')
    await registerDelegatedCommercialAuthority({ tenantId: tenant.tenantId, business: 'revenue-recovery', action: 'send_email', level: 'autonomous', maxDailyCount: 10, allowedChannels: ['email'], approvedByUserId: tenant.ownerUserId })
    const key = unique('sandbox-action')
    const queued = await submitCommercialExternalAction({ tenantId: tenant.tenantId, business: 'revenue-recovery', provider: 'resend', action: 'send_email', actor: 'revenue_recovery_leader', credentialId: credential.credentialId, idempotencyKey: key, channel: 'email', mode: 'sandbox', input: { to: ['test@example.com'], subject: 'Sandbox', html: '<p>Sandbox</p>', from: 'Agent007 <noreply@example.com>' } })
    const completed = await runCommercialExternalAction(queued.executionId, tenant.tenantId)
    expect(completed?.status).toBe('succeeded')
    const duplicate = await submitCommercialExternalAction({ tenantId: tenant.tenantId, business: 'revenue-recovery', provider: 'resend', action: 'send_email', actor: 'revenue_recovery_leader', credentialId: credential.credentialId, idempotencyKey: key, channel: 'email', mode: 'sandbox', input: { to: ['test@example.com'], subject: 'Different', html: '<p>Ignored</p>', from: 'Agent007 <noreply@example.com>' } })
    expect(duplicate.executionId).toBe(queued.executionId)
    expect((await getPhase6Execution(queued.executionId, tenant.tenantId))?.status).toBe('succeeded')
  })

  it('enforces tenant boundaries', async () => {
    registerCommercialProviderAdapter(resendCommercialProviderAdapter)
    const tenantA = await tenantFor('tenant-a')
    const tenantB = await tenantFor('tenant-b')
    const credential = await registerCommercialCredential({ tenantId: tenantA.tenantId, business: 'revenue-recovery', provider: 'resend', externalAccountId: 'acct-isolated', scopes: ['emails'], secretRef: 'env:RESEND_API_KEY' })
    await transitionCommercialCredential(credential.credentialId, tenantA.tenantId, 'connected')
    await registerDelegatedCommercialAuthority({ tenantId: tenantB.tenantId, business: 'revenue-recovery', action: 'send_email', level: 'autonomous', maxDailyCount: 5, approvedByUserId: tenantB.ownerUserId })
    await expect(submitCommercialExternalAction({ tenantId: tenantB.tenantId, business: 'revenue-recovery', provider: 'resend', action: 'send_email', actor: 'revenue_recovery_leader', credentialId: credential.credentialId, idempotencyKey: unique('cross-tenant'), mode: 'sandbox', input: { to: ['test@example.com'], subject: 'Isolation', html: '<p>Isolation</p>' } })).rejects.toThrow('Credential reference not found')
  })
})

describe('webhooks and failure handling', () => {
  it('verifies webhook signatures and deduplicates provider events', async () => {
    const tenant = await tenantFor('webhook')
    const payload = JSON.stringify({ id: 'evt-1', type: 'delivered' })
    const signingKey = 'phase6-test-signing-key'
    const signature = signPhase6Webhook(payload, signingKey)
    expect(verifyPhase6WebhookSignature(payload, signature, signingKey)).toBe(true)
    expect(verifyPhase6WebhookSignature(payload, 'bad', signingKey)).toBe(false)
    let count = 0
    const first = await processCommercialWebhook({ provider: 'resend', tenantId: tenant.tenantId, business: 'revenue-recovery', eventType: 'email.delivered', externalEventId: 'evt-1', payload: { id: 'evt-1' }, signature, signingSecret: signingKey, process: async () => { count += 1 } })
    const second = await processCommercialWebhook({ provider: 'resend', tenantId: tenant.tenantId, business: 'revenue-recovery', eventType: 'email.delivered', externalEventId: 'evt-1', payload: { id: 'evt-1' }, signature, signingSecret: signingKey, process: async () => { count += 1 } })
    expect(first.status).toBe('processed')
    expect(second.status).toBe('duplicate')
    expect(count).toBe(1)
  })

  it('caps retry attempts', async () => {
    const adapter: CommercialProviderAdapter = {
      manifest: { id: 'phase6-failing-test', displayName: 'Failing Test Provider', version: '1.0.0', capabilities: ['generic'], environments: ['sandbox'] },
      async execute() { throw new Error('simulated provider outage') },
    }
    registerCommercialProviderAdapter(adapter)
    const tenant = await tenantFor('retry')
    const credential = await registerCommercialCredential({ tenantId: tenant.tenantId, business: 'operations-kit', provider: adapter.manifest.id, externalAccountId: 'test', scopes: ['generic'], secretRef: 'env:PHASE6_TEST_SECRET' })
    await transitionCommercialCredential(credential.credentialId, tenant.tenantId, 'connected')
    await registerDelegatedCommercialAuthority({ tenantId: tenant.tenantId, business: 'operations-kit', action: 'run_test', level: 'autonomous', maxDailyCount: 100, approvedByUserId: tenant.ownerUserId })
    const execution = await submitCommercialExternalAction({ tenantId: tenant.tenantId, business: 'operations-kit', provider: adapter.manifest.id, action: 'run_test', actor: 'operations_kit_leader', credentialId: credential.credentialId, idempotencyKey: unique('retry'), mode: 'sandbox', maxAttempts: 3, input: {} })
    expect((await runCommercialExternalAction(execution.executionId, tenant.tenantId))?.status).toBe('waiting')
    expect((await runCommercialExternalAction(execution.executionId, tenant.tenantId))?.status).toBe('waiting')
    const terminal = await runCommercialExternalAction(execution.executionId, tenant.tenantId)
    expect(terminal?.status).toBe('failed')
    expect(terminal?.attempts).toBe(3)
    expect((await getPhase6ProviderObservations()).find((item) => item.provider === adapter.manifest.id)?.failures).toBe(3)
  })
})
