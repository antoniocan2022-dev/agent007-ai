/**
 * Commercial Integration & Execution Platform — Phase 6
 *
 * This is the governed boundary between Agent007's commercial control plane
 * and external systems. Provider implementations remain replaceable adapters;
 * policy, identity, idempotency, evidence and audit remain platform-owned.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { db } from './db'
import {
  COMMERCIAL_CATEGORIES,
  isCommercialBusiness,
  type CommercialBusiness,
  type CommercialEvent,
  type CommercialWorkflow,
  type CredentialReference,
  type CredentialStatus,
  type DelegatedAuthority,
  type WorkflowStatus,
} from './commercial-control-plane'
import { auditCommercialAction, evaluateDelegatedAuthority } from './commercial-control-plane-governance'
import { transitionCommercialWorkflow } from './commercial-control-plane-runtime'

export type ProviderEnvironment = 'sandbox' | 'live'
export type ProviderCapability = 'read' | 'write' | 'send' | 'schedule' | 'charge' | 'refund' | 'publish' | 'search' | 'job_search'
export type ExternalActionStatus = 'queued' | 'preflight' | 'awaiting_approval' | 'authorized' | 'dispatched' | 'succeeded' | 'failed' | 'blocked' | 'cancelled'
export type WebhookReceiptStatus = 'accepted' | 'processed' | 'failed' | 'ignored'
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

export interface CommercialProviderDefinition {
  providerId: string
  name: string
  version: string
  capabilities: ProviderCapability[]
  businesses: CommercialBusiness[]
  environments: ProviderEnvironment[]
  webhookEvents: string[]
  status: 'enabled' | 'disabled'
  createdAt: string
  updatedAt: string
}

export interface CommercialProviderExecutionContext {
  tenantId: string
  business: CommercialBusiness
  provider: string
  operation: ProviderCapability
  environment: ProviderEnvironment
  actionId: string
  credential: CredentialReference | null
  payload: Record<string, unknown>
}

export interface CommercialProviderExecutionResult {
  ok: boolean
  externalId?: string | null
  output?: Record<string, unknown> | null
  observedAt: string
  latencyMs: number
  errorCode?: string | null
  errorMessage?: string | null
}

export interface CommercialProviderAdapter {
  providerId: string
  execute(context: CommercialProviderExecutionContext): Promise<CommercialProviderExecutionResult>
  validateCredential?(credential: CredentialReference): Promise<{ ok: boolean; message?: string }>
}

export interface ExternalAction {
  actionId: string
  tenantId: string
  business: CommercialBusiness
  provider: string
  operation: ProviderCapability
  channel: string | null
  environment: ProviderEnvironment
  spend: number
  requestedBy: string
  authorityId: string | null
  credentialId: string | null
  idempotencyKey: string
  status: ExternalActionStatus
  payloadHash: string
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface WebhookReceipt {
  receiptId: string
  tenantId: string
  business: CommercialBusiness
  provider: string
  eventType: string
  externalEventId: string
  payloadHash: string
  payload: Record<string, unknown>
  signatureVerified: boolean
  status: WebhookReceiptStatus
  attemptCount: number
  receivedAt: string
  processedAt: string | null
  lastError: string | null
}

export interface ProviderObservation {
  observationId: string
  tenantId: string
  business: CommercialBusiness
  provider: string
  kind: 'action' | 'webhook' | 'credential' | 'healthcheck'
  ok: boolean
  latencyMs: number | null
  errorCode: string | null
  occurredAt: string
}

export interface ProviderHealthReport {
  provider: string
  status: ProviderHealthStatus
  observations: number
  successes: number
  failures: number
  successRate: number
  averageLatencyMs: number | null
  lastObservedAt: string | null
}

export interface SandboxSimulation {
  simulationId: string
  action: Partial<ExternalAction>
  policy: { allowed: boolean; reason: string }
  result: { ok: boolean; preview: string }
  createdAt: string
}

const PROVIDER_CATEGORY = COMMERCIAL_CATEGORIES.provider
const ACTION_CATEGORY = COMMERCIAL_CATEGORIES.action
const WEBHOOK_CATEGORY = COMMERCIAL_CATEGORIES.webhook
const OBSERVATION_CATEGORY = COMMERCIAL_CATEGORIES.observation
const SANDBOX_CATEGORY = COMMERCIAL_CATEGORIES.sandbox

const adapters = new Map<string, CommercialProviderAdapter>()
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const now = () => new Date().toISOString()
const unique = <T>(values: T[]) => [...new Set(values)]
const persistenceKey = (kind: string, tenantId: string, id: string) => `${kind}:${tenantId}:${id}`

async function rows<T>(category: string, tenantId?: string, limit = 5000): Promise<T[]> {
  const result = await db.memory.findMany({ where: { category }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 5000) })
  return result
    .map((record) => {
      try { return JSON.parse(record.value) as T } catch { return null }
    })
    .filter((value): value is T => !!value && (!tenantId || (value as { tenantId?: string }).tenantId === tenantId))
}

async function writeUnique<T>(key: string, category: string, value: T): Promise<{ created: boolean; value: T }> {
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, value: JSON.parse(existing.value) as T }
  await db.memory.create({ data: { key, category, value: JSON.stringify(value) } })
  return { created: true, value }
}

function payloadHash(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function registerCommercialProvider(input: Omit<CommercialProviderDefinition, 'createdAt' | 'updatedAt'>): Promise<CommercialProviderDefinition> {
  if (!clean(input.providerId) || !clean(input.name) || !clean(input.version)) throw new Error('providerId, name, and version are required.')
  if (!input.businesses.length || !input.environments.length || !input.capabilities.length) throw new Error('Provider must declare businesses, environments, and capabilities.')
  const definition: CommercialProviderDefinition = {
    ...input,
    providerId: clean(input.providerId).toLowerCase(),
    name: clean(input.name),
    version: clean(input.version),
    capabilities: unique(input.capabilities),
    businesses: unique(input.businesses),
    environments: unique(input.environments),
    webhookEvents: unique((input.webhookEvents ?? []).map(clean).filter(Boolean)),
    createdAt: now(),
    updatedAt: now(),
  }
  return (await writeUnique(persistenceKey('provider', 'global', definition.providerId), PROVIDER_CATEGORY, definition)).value
}

export function registerCommercialProviderAdapter(adapter: CommercialProviderAdapter): void {
  if (!clean(adapter.providerId)) throw new Error('providerId is required.')
  if (typeof adapter.execute !== 'function') throw new Error(`Adapter ${adapter.providerId} must implement execute().`)
  if (adapters.has(adapter.providerId)) throw new Error(`Provider adapter ${adapter.providerId} is already registered.`)
  adapters.set(adapter.providerId, adapter)
}

export async function getCommercialProvider(providerId: string): Promise<CommercialProviderDefinition | null> {
  const record = await db.memory.findUnique({ where: { key: persistenceKey('provider', 'global', clean(providerId).toLowerCase()) } })
  if (!record) return null
  try { return JSON.parse(record.value) as CommercialProviderDefinition } catch { return null }
}

export function listCommercialProviderAdapters(): string[] { return [...adapters.keys()].sort() }

export async function registerCommercialCredentialReference(input: Omit<CredentialReference, 'credentialId' | 'createdAt' | 'updatedAt' | 'lastValidatedAt' | 'status'> & { credentialId?: string; status?: CredentialStatus; lastValidatedAt?: string | null }) {
  if (/^\s*(sk_|rk_|pk_|token_|password=)/i.test(input.secretRef)) throw new Error('Raw credential material is not allowed; use an opaque secretRef.')
  const credentialId = input.credentialId?.trim() || `cred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const credential: CredentialReference = {
    credentialId,
    tenantId: clean(input.tenantId),
    business: input.business,
    provider: clean(input.provider).toLowerCase(),
    externalAccountId: input.externalAccountId?.trim() || null,
    scopes: unique((input.scopes ?? []).map(clean).filter(Boolean)),
    status: input.status ?? 'pending',
    secretRef: clean(input.secretRef),
    createdAt: now(),
    updatedAt: now(),
    lastValidatedAt: input.lastValidatedAt ?? null,
  }
  if (!credential.tenantId || !isCommercialBusiness(credential.business)) throw new Error('Valid tenantId and business are required.')
  const identity = `${credential.business}:${credential.provider}:${credential.externalAccountId ?? credential.credentialId}`
  return writeUnique(persistenceKey('credential', credential.tenantId, identity), COMMERCIAL_CATEGORIES.credential, credential)
}

export async function listCommercialCredentials(tenantId: string, business?: CommercialBusiness): Promise<CredentialReference[]> {
  return (await rows<CredentialReference>(COMMERCIAL_CATEGORIES.credential, tenantId)).filter((credential) => !business || credential.business === business)
}

const credentialTransitions: Record<CredentialStatus, readonly CredentialStatus[]> = {
  pending: ['connected', 'error', 'revoked'],
  connected: ['expired', 'revoked', 'error', 'connected'],
  expired: ['connected', 'revoked', 'error'],
  revoked: ['pending'],
  error: ['pending', 'connected', 'revoked'],
}

export async function transitionCommercialCredential(input: { tenantId: string; credentialId: string; status: CredentialStatus }): Promise<CredentialReference | null> {
  const credentials = await listCommercialCredentials(input.tenantId)
  const current = credentials.find((credential) => credential.credentialId === input.credentialId)
  if (!current) return null
  if (!credentialTransitions[current.status].includes(input.status)) throw new Error(`Credential transition ${current.status} -> ${input.status} is not permitted.`)
  const updated = { ...current, status: input.status, updatedAt: now(), lastValidatedAt: input.status === 'connected' ? now() : current.lastValidatedAt }
  const record = await db.memory.findUnique({ where: { key: persistenceKey('credential', input.tenantId, `${current.business}:${current.provider}:${current.externalAccountId ?? current.credentialId}`) } })
  if (!record) throw new Error('Credential persistence record is missing.')
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(updated) } })
  return updated
}

export async function validateCommercialCredential(input: { tenantId: string; credentialId: string }): Promise<{ ok: boolean; credential: CredentialReference | null; message: string }> {
  const credentials = await listCommercialCredentials(input.tenantId)
  const credential = credentials.find((item) => item.credentialId === input.credentialId)
  if (!credential) return { ok: false, credential: null, message: 'Credential reference was not found.' }
  const adapter = adapters.get(credential.provider)
  if (!adapter?.validateCredential) {
    await recordProviderObservation({ tenantId: input.tenantId, business: credential.business, provider: credential.provider, kind: 'credential', ok: false, latencyMs: null, errorCode: 'ADAPTER_VALIDATION_UNAVAILABLE' })
    return { ok: false, credential, message: 'Provider adapter does not expose credential validation.' }
  }
  const started = Date.now()
  try {
    const result = await adapter.validateCredential(credential)
    await transitionCommercialCredential({ tenantId: input.tenantId, credentialId: credential.credentialId, status: result.ok ? 'connected' : 'error' })
    await recordProviderObservation({ tenantId: input.tenantId, business: credential.business, provider: credential.provider, kind: 'credential', ok: result.ok, latencyMs: Date.now() - started, errorCode: result.ok ? null : 'CREDENTIAL_REJECTED' })
    return { ok: result.ok, credential: result.ok ? await findCredential(input.tenantId, input.credentialId) : credential, message: result.message ?? (result.ok ? 'Credential validated.' : 'Credential validation failed.') }
  } catch (error) {
    await transitionCommercialCredential({ tenantId: input.tenantId, credentialId: credential.credentialId, status: 'error' })
    await recordProviderObservation({ tenantId: input.tenantId, business: credential.business, provider: credential.provider, kind: 'credential', ok: false, latencyMs: Date.now() - started, errorCode: 'CREDENTIAL_VALIDATION_ERROR' })
    return { ok: false, credential, message: error instanceof Error ? error.message : String(error) }
  }
}

async function findCredential(tenantId: string, credentialId: string): Promise<CredentialReference | null> {
  return (await listCommercialCredentials(tenantId)).find((item) => item.credentialId === credentialId) ?? null
}

async function actualDailyActionCount(tenantId: string, business: CommercialBusiness, action: string): Promise<number> {
  const since = Date.now() - 24 * 60 * 60 * 1000
  const audits = await rows<{ tenantId: string; business: CommercialBusiness; action: string; allowed: boolean; createdAt: string }>(COMMERCIAL_CATEGORIES.audit, tenantId)
  return audits.filter((audit) => audit.business === business && audit.action === action && audit.allowed && new Date(audit.createdAt).getTime() >= since).length
}

const actionTransitions: Record<ExternalActionStatus, readonly ExternalActionStatus[]> = {
  queued: ['preflight', 'cancelled'],
  preflight: ['awaiting_approval', 'authorized', 'blocked', 'cancelled'],
  awaiting_approval: ['authorized', 'cancelled', 'blocked'],
  authorized: ['dispatched', 'cancelled', 'blocked'],
  dispatched: ['succeeded', 'failed'],
  succeeded: [],
  failed: ['queued', 'cancelled'],
  blocked: [],
  cancelled: [],
}

async function saveAction(action: ExternalAction): Promise<void> {
  const record = await db.memory.findUnique({ where: { key: persistenceKey('action', action.tenantId, action.idempotencyKey) } })
  if (!record) throw new Error('External action persistence record is missing.')
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(action) } })
}

export async function transitionExternalAction(input: { tenantId: string; actionId: string; status: ExternalActionStatus; result?: Record<string, unknown> | null; error?: string | null }): Promise<ExternalAction | null> {
  const actions = await rows<ExternalAction>(ACTION_CATEGORY, input.tenantId)
  const current = actions.find((action) => action.actionId === input.actionId)
  if (!current) return null
  if (!actionTransitions[current.status].includes(input.status)) throw new Error(`External action transition ${current.status} -> ${input.status} is not permitted.`)
  const updated: ExternalAction = { ...current, status: input.status, result: input.result === undefined ? current.result : input.result, error: input.error === undefined ? current.error : input.error, updatedAt: now() }
  await saveAction(updated)
  return updated
}

export async function requestExternalAction(input: { tenantId: string; business: CommercialBusiness; provider: string; operation: ProviderCapability; channel?: string | null; environment?: ProviderEnvironment; spend?: number; requestedBy: string; payload: Record<string, unknown>; idempotencyKey: string; credentialId?: string | null }): Promise<ExternalAction> {
  if (!input.tenantId.trim() || !isCommercialBusiness(input.business) || !input.provider.trim() || !input.requestedBy.trim() || !input.idempotencyKey.trim()) throw new Error('tenantId, business, provider, requestedBy, and idempotencyKey are required.')
  const existing = (await rows<ExternalAction>(ACTION_CATEGORY, input.tenantId)).find((action) => action.idempotencyKey === input.idempotencyKey)
  if (existing) return existing
  const providerId = clean(input.provider).toLowerCase()
  const provider = await getCommercialProvider(providerId)
  if (!provider || provider.status !== 'enabled') throw new Error(`Provider ${providerId} is not enabled.`)
  if (!provider.businesses.includes(input.business)) throw new Error(`Provider ${providerId} is not enabled for ${input.business}.`)
  if (!provider.capabilities.includes(input.operation)) throw new Error(`Provider ${providerId} does not support operation ${input.operation}.`)
  const environment = input.environment ?? 'live'
  if (!provider.environments.includes(environment)) throw new Error(`Provider ${providerId} does not support ${environment} execution.`)
  const spend = Number.isFinite(input.spend) ? Math.max(0, input.spend as number) : 0
  const action: ExternalAction = {
    actionId: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId,
    business: input.business,
    provider: providerId,
    operation: input.operation,
    channel: input.channel?.trim() || null,
    environment,
    spend,
    requestedBy: clean(input.requestedBy),
    authorityId: null,
    credentialId: input.credentialId?.trim() || null,
    idempotencyKey: clean(input.idempotencyKey),
    status: 'queued',
    payloadHash: payloadHash(input.payload ?? {}),
    payload: input.payload ?? {},
    result: null,
    error: null,
    createdAt: now(),
    updatedAt: now(),
  }
  const stored = await writeUnique(persistenceKey('action', action.tenantId, action.idempotencyKey), ACTION_CATEGORY, action)
  return executeExternalAction(stored.value)
}

async function executeExternalAction(action: ExternalAction): Promise<ExternalAction> {
  await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'preflight' })
  const dailyCount = await actualDailyActionCount(action.tenantId, action.business, action.operation)
  const policy = await evaluateDelegatedAuthority({ tenantId: action.tenantId, business: action.business, action: action.operation, spend: action.spend, channel: action.channel ?? undefined, dailyCount: dailyCount + 1 })
  if (!policy.allowed) {
    const status: ExternalActionStatus = policy.authority?.level === 'human_approval' ? 'awaiting_approval' : 'blocked'
    const updated = await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status, error: policy.reason })
    await auditCommercialAction({ tenantId: action.tenantId, business: action.business, action: action.operation, actor: action.requestedBy, entityType: 'external_action', entityId: action.actionId, allowed: false, reason: policy.reason, metadata: { provider: action.provider, environment: action.environment } })
    return updated ?? action
  }
  const authorized = await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'authorized' })
  if (!authorized) throw new Error('Action disappeared during authorization.')
  const withAuthority: ExternalAction = { ...authorized, authorityId: policy.authority?.authorityId ?? null, updatedAt: now() }
  await saveAction(withAuthority)
  await auditCommercialAction({ tenantId: action.tenantId, business: action.business, action: action.operation, actor: action.requestedBy, entityType: 'external_action', entityId: action.actionId, allowed: true, reason: policy.reason, metadata: { provider: action.provider, environment: action.environment } })
  return dispatchExternalAction(withAuthority)
}

export async function approveExternalAction(input: { tenantId: string; actionId: string; approvedByUserId: string }): Promise<ExternalAction> {
  const actions = await rows<ExternalAction>(ACTION_CATEGORY, input.tenantId)
  const action = actions.find((item) => item.actionId === input.actionId)
  if (!action) throw new Error('External action not found.')
  if (action.status !== 'awaiting_approval') throw new Error(`Action ${action.actionId} is not awaiting approval.`)
  if (!input.approvedByUserId.trim()) throw new Error('approvedByUserId is required.')
  const authority = await evaluateDelegatedAuthority({ tenantId: action.tenantId, business: action.business, action: action.operation, spend: action.spend, channel: action.channel ?? undefined, dailyCount: (await actualDailyActionCount(action.tenantId, action.business, action.operation)) + 1 })
  if (!authority.authority || authority.authority.level === 'human_approval') {
    const updated = await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'authorized' })
    if (!updated) throw new Error('Action disappeared while approving.')
    await saveAction({ ...updated, authorityId: authority.authority?.authorityId ?? null, updatedAt: now() })
    await auditCommercialAction({ tenantId: action.tenantId, business: action.business, action: action.operation, actor: input.approvedByUserId, entityType: 'external_action_approval', entityId: action.actionId, allowed: true, reason: 'Explicit owner approval recorded.', metadata: { provider: action.provider } })
    return dispatchExternalAction({ ...updated, authorityId: authority.authority?.authorityId ?? null, updatedAt: now() })
  }
  throw new Error('Approval request no longer matches current authority state.')
}

async function dispatchExternalAction(action: ExternalAction): Promise<ExternalAction> {
  if (action.environment === 'sandbox') return simulateExternalAction({ ...action, status: 'authorized' })
  const adapter = adapters.get(action.provider)
  if (!adapter) return (await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'failed', error: 'No runtime adapter is registered for this provider.' })) ?? action
  const credential = action.credentialId ? await findCredential(action.tenantId, action.credentialId) : null
  if (!credential || credential.status !== 'connected') return (await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'failed', error: 'A connected credential reference is required for live execution.' })) ?? action
  await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'dispatched' })
  const started = Date.now()
  try {
    const result = await adapter.execute({ tenantId: action.tenantId, business: action.business, provider: action.provider, operation: action.operation, environment: action.environment, actionId: action.actionId, credential, payload: action.payload })
    await recordProviderObservation({ tenantId: action.tenantId, business: action.business, provider: action.provider, kind: 'action', ok: result.ok, latencyMs: result.latencyMs, errorCode: result.errorCode ?? null })
    const final = await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: result.ok ? 'succeeded' : 'failed', result: result.output ?? { externalId: result.externalId ?? null }, error: result.errorMessage ?? null })
    await auditCommercialAction({ tenantId: action.tenantId, business: action.business, action: action.operation, actor: action.requestedBy, entityType: 'external_action_result', entityId: action.actionId, allowed: result.ok, reason: result.ok ? 'Provider execution succeeded.' : (result.errorMessage ?? 'Provider execution failed.'), metadata: { provider: action.provider, externalId: result.externalId ?? null, latencyMs: result.latencyMs } })
    if (result.ok) await recordCommercialExecutionEvent(action, result)
    return final ?? action
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordProviderObservation({ tenantId: action.tenantId, business: action.business, provider: action.provider, kind: 'action', ok: false, latencyMs: Date.now() - started, errorCode: 'ADAPTER_EXECUTION_ERROR' })
    return (await transitionExternalAction({ tenantId: action.tenantId, actionId: action.actionId, status: 'failed', error: message })) ?? action
  }
}

async function recordCommercialExecutionEvent(action: ExternalAction, result: CommercialProviderExecutionResult): Promise<CommercialEvent> {
  const event: CommercialEvent = {
    eventId: `evt_action_${action.actionId}`,
    tenantId: action.tenantId,
    business: action.business,
    type: `external_action.${action.operation}.succeeded`,
    source: `provider:${action.provider}`,
    entityType: 'external_action',
    entityId: action.actionId,
    payload: { externalId: result.externalId ?? null, output: result.output ?? null },
    occurredAt: result.observedAt,
    acceptedAt: now(),
    status: 'accepted',
    idempotencyKey: `action-result:${action.idempotencyKey}`,
  }
  const existing = await db.memory.findUnique({ where: { key: persistenceKey('event', action.tenantId, event.idempotencyKey) } })
  if (existing) return JSON.parse(existing.value) as CommercialEvent
  await db.memory.create({ data: { key: persistenceKey('event', action.tenantId, event.idempotencyKey), category: COMMERCIAL_CATEGORIES.event, value: JSON.stringify(event) } })
  return event
}

export function createWebhookSignature(body: string, secret: string, timestampSeconds = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac('sha256', secret).update(`${timestampSeconds}.${body}`).digest('hex')
  return `t=${timestampSeconds},v1=${digest}`
}

export function verifyWebhookSignature(body: string, signature: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  const parts = new Map(signature.split(',').map((part) => part.split('=', 2) as [string, string]))
  const timestamp = Number(parts.get('t'))
  const expected = parts.get('v1')
  if (!Number.isFinite(timestamp) || !expected || Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false
  const actual = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  const a = Buffer.from(actual, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function ingestExternalWebhook(input: { tenantId: string; business: CommercialBusiness; provider: string; eventType: string; externalEventId: string; body: string; signature: string; signingSecret: string }): Promise<WebhookReceipt> {
  if (!isCommercialBusiness(input.business) || !input.tenantId.trim() || !input.provider.trim() || !input.externalEventId.trim()) throw new Error('Valid webhook identity is required.')
  const provider = await getCommercialProvider(input.provider)
  if (!provider) throw new Error(`Unknown provider ${input.provider}.`)
  const signatureVerified = verifyWebhookSignature(input.body, input.signature, input.signingSecret)
  if (!signatureVerified) throw new Error('Webhook signature verification failed.')
  let payload: Record<string, unknown>
  try { payload = JSON.parse(input.body) as Record<string, unknown> } catch { throw new Error('Webhook payload is not valid JSON.') }
  const receipt: WebhookReceipt = {
    receiptId: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId,
    business: input.business,
    provider: clean(input.provider).toLowerCase(),
    eventType: clean(input.eventType),
    externalEventId: clean(input.externalEventId),
    payloadHash: createHash('sha256').update(input.body).digest('hex'),
    payload,
    signatureVerified: true,
    status: 'accepted',
    attemptCount: 0,
    receivedAt: now(),
    processedAt: null,
    lastError: null,
  }
  const identity = `${receipt.provider}:${receipt.externalEventId}`
  const stored = await writeUnique(persistenceKey('webhook', receipt.tenantId, identity), WEBHOOK_CATEGORY, receipt)
  if (!stored.created) return stored.value
  return processWebhookReceipt(stored.value)
}

async function processWebhookReceipt(receipt: WebhookReceipt): Promise<WebhookReceipt> {
  const eventKey = `webhook:${receipt.provider}:${receipt.externalEventId}`
  const event: CommercialEvent = {
    eventId: `evt_webhook_${receipt.receiptId}`,
    tenantId: receipt.tenantId,
    business: receipt.business,
    type: receipt.eventType,
    source: `webhook:${receipt.provider}`,
    entityType: 'provider_event',
    entityId: receipt.externalEventId,
    payload: receipt.payload,
    occurredAt: receipt.receivedAt,
    acceptedAt: now(),
    status: 'accepted',
    idempotencyKey: eventKey,
  }
  try {
    const existing = await db.memory.findUnique({ where: { key: persistenceKey('event', receipt.tenantId, eventKey) } })
    if (!existing) await db.memory.create({ data: { key: persistenceKey('event', receipt.tenantId, eventKey), category: COMMERCIAL_CATEGORIES.event, value: JSON.stringify(event) } })
    const updated = { ...receipt, status: 'processed' as const, attemptCount: receipt.attemptCount + 1, processedAt: now(), lastError: null }
    await saveWebhook(updated)
    await recordProviderObservation({ tenantId: receipt.tenantId, business: receipt.business, provider: receipt.provider, kind: 'webhook', ok: true, latencyMs: null, errorCode: null })
    return updated
  } catch (error) {
    const updated = { ...receipt, status: 'failed' as const, attemptCount: receipt.attemptCount + 1, lastError: error instanceof Error ? error.message : String(error) }
    await saveWebhook(updated)
    await recordProviderObservation({ tenantId: receipt.tenantId, business: receipt.business, provider: receipt.provider, kind: 'webhook', ok: false, latencyMs: null, errorCode: 'WEBHOOK_PROCESSING_ERROR' })
    return updated
  }
}

async function saveWebhook(receipt: WebhookReceipt): Promise<void> {
  const key = persistenceKey('webhook', receipt.tenantId, `${receipt.provider}:${receipt.externalEventId}`)
  const record = await db.memory.findUnique({ where: { key } })
  if (!record) throw new Error('Webhook persistence record is missing.')
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(receipt) } })
}

export async function replayExternalWebhook(input: { tenantId: string; receiptId: string }): Promise<WebhookReceipt> {
  const receipts = await rows<WebhookReceipt>(WEBHOOK_CATEGORY, input.tenantId)
  const receipt = receipts.find((item) => item.receiptId === input.receiptId)
  if (!receipt) throw new Error('Webhook receipt not found.')
  if (!['failed', 'accepted', 'processed'].includes(receipt.status)) throw new Error(`Webhook ${receipt.receiptId} cannot be replayed from ${receipt.status}.`)
  const replayed: WebhookReceipt = { ...receipt, status: 'accepted', lastError: null, processedAt: null }
  await saveWebhook(replayed)
  return processWebhookReceipt(replayed)
}

export async function recordProviderObservation(input: Omit<ProviderObservation, 'observationId' | 'occurredAt'>): Promise<ProviderObservation> {
  const observation: ProviderObservation = { ...input, observationId: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, occurredAt: now() }
  await db.memory.create({ data: { key: persistenceKey('observation', input.tenantId, observation.observationId), category: OBSERVATION_CATEGORY, value: JSON.stringify(observation) } })
  return observation
}

export async function getProviderHealth(tenantId: string, provider: string): Promise<ProviderHealthReport> {
  const observations = (await rows<ProviderObservation>(OBSERVATION_CATEGORY, tenantId)).filter((item) => item.provider === clean(provider).toLowerCase())
  const successes = observations.filter((item) => item.ok).length
  const failures = observations.length - successes
  const latencies = observations.map((item) => item.latencyMs).filter((value): value is number => typeof value === 'number' && value >= 0)
  const averageLatencyMs = latencies.length ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)) : null
  const successRate = observations.length ? Number((successes / observations.length).toFixed(4)) : 0
  const lastObservedAt = observations.map((item) => item.occurredAt).sort().at(-1) ?? null
  let status: ProviderHealthStatus = 'unknown'
  if (observations.length) status = successRate >= 0.98 ? 'healthy' : successRate >= 0.9 ? 'degraded' : 'down'
  return { provider: clean(provider).toLowerCase(), status, observations: observations.length, successes, failures, successRate, averageLatencyMs, lastObservedAt }
}

export async function listProviderHealth(tenantId: string): Promise<ProviderHealthReport[]> {
  const providers = new Set((await rows<ProviderObservation>(OBSERVATION_CATEGORY, tenantId)).map((item) => item.provider))
  return Promise.all([...providers].sort().map((provider) => getProviderHealth(tenantId, provider)))
}

export async function simulateExternalAction(input: Partial<ExternalAction> & { tenantId: string; business: CommercialBusiness; provider: string; operation: ProviderCapability; payload: Record<string, unknown> }): Promise<ExternalAction> {
  const provider = await getCommercialProvider(input.provider)
  if (!provider) throw new Error(`Unknown provider ${input.provider}.`)
  const spend = Number.isFinite(input.spend) ? Math.max(0, input.spend as number) : 0
  const dailyCount = await actualDailyActionCount(input.tenantId, input.business, input.operation)
  const policy = await evaluateDelegatedAuthority({ tenantId: input.tenantId, business: input.business, action: input.operation, spend, channel: input.channel ?? undefined, dailyCount: dailyCount + 1 })
  const action: ExternalAction = {
    actionId: input.actionId ?? `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: input.tenantId,
    business: input.business,
    provider: clean(input.provider).toLowerCase(),
    operation: input.operation,
    channel: input.channel ?? null,
    environment: 'sandbox',
    spend,
    requestedBy: input.requestedBy ?? 'phase6-sandbox',
    authorityId: policy.authority?.authorityId ?? null,
    credentialId: input.credentialId ?? null,
    idempotencyKey: input.idempotencyKey ?? `sandbox:${Date.now()}`,
    status: policy.allowed ? 'succeeded' : 'blocked',
    payloadHash: payloadHash(input.payload),
    payload: input.payload,
    result: policy.allowed ? { simulated: true, provider: provider.providerId, operation: input.operation } : null,
    error: policy.allowed ? null : policy.reason,
    createdAt: now(),
    updatedAt: now(),
  }
  const simulation: SandboxSimulation = { simulationId: `sandbox_${action.actionId}`, action, policy: { allowed: policy.allowed, reason: policy.reason }, result: { ok: policy.allowed, preview: policy.allowed ? 'Sandbox action would execute.' : `Sandbox blocked: ${policy.reason}` }, createdAt: now() }
  await writeUnique(persistenceKey('sandbox', input.tenantId, simulation.simulationId), SANDBOX_CATEGORY, simulation)
  return action
}

export async function replayWebhookInSandbox(input: { tenantId: string; receiptId: string }): Promise<SandboxSimulation> {
  const receipts = await rows<WebhookReceipt>(WEBHOOK_CATEGORY, input.tenantId)
  const receipt = receipts.find((item) => item.receiptId === input.receiptId)
  if (!receipt) throw new Error('Webhook receipt not found.')
  const simulation: SandboxSimulation = {
    simulationId: `sandbox_webhook_${receipt.receiptId}_${Date.now()}`,
    action: { tenantId: receipt.tenantId, business: receipt.business, provider: receipt.provider, operation: 'read', environment: 'sandbox', payload: receipt.payload },
    policy: { allowed: true, reason: 'Webhook replay is simulation-only and does not invoke an external provider.' },
    result: { ok: true, preview: `Replayed ${receipt.eventType} (${receipt.externalEventId}) in sandbox.` },
    createdAt: now(),
  }
  await writeUnique(persistenceKey('sandbox', input.tenantId, simulation.simulationId), SANDBOX_CATEGORY, simulation)
  return simulation
}

export function validatePhase6ExecutionContracts(): string[] {
  const errors: string[] = []
  const providerCapabilities: ProviderCapability[] = ['read', 'write', 'send', 'schedule', 'charge', 'refund', 'publish', 'search', 'job_search']
  if (new Set(providerCapabilities).size !== providerCapabilities.length) errors.push('Provider capability taxonomy contains duplicates.')
  for (const status of Object.keys(actionTransitions) as ExternalActionStatus[]) {
    for (const next of actionTransitions[status]) if (!actionTransitions[next].includes(status) && (next === 'queued' && status === 'failed')) errors.push(`Action transition contract is inconsistent for ${status} -> ${next}.`)
  }
  return errors
}

export const PHASE6_TOOL_IDS = [
  'phase6_provider_registry',
  'phase6_provider_adapter',
  'phase6_execution_runtime',
  'phase6_credential_lifecycle',
  'phase6_action_gateway',
  'phase6_webhook_gateway',
  'phase6_provider_observability',
  'phase6_sandbox_mode',
  'phase6_webhook_replay',
] as const

export type Phase6ToolId = typeof PHASE6_TOOL_IDS[number]
export const PHASE6_VERSION = 1

/** Re-export the existing lifecycle boundary for one canonical Phase 6 runtime entry point. */
export { transitionCommercialWorkflow }
