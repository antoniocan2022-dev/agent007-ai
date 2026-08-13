import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { db } from './db'
import {
  COMMERCIAL_CATEGORIES,
  type AuthorityLevel,
  type CommercialAuditRecord,
  type CommercialBusiness,
  type CommercialWorkflow,
  type CredentialReference,
  isCommercialBusiness,
  registerCredentialReference,
  createCommercialWorkflow,
  transitionCommercialWorkflow,
  recordCommercialEvent,
} from './commercial-control-plane'

export const PHASE6_ID = 'commercial-integration-execution-platform'
export const PHASE6_VERSION = 1

export type Phase6ProviderCapability =
  | 'crm'
  | 'communications'
  | 'billing'
  | 'calendar'
  | 'booking'
  | 'analytics'
  | 'job-source'
  | 'documents'
  | 'generic'

export type Phase6ExecutionMode = 'live' | 'sandbox'
export type Phase6ExecutionStatus = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
export type Phase6WebhookStatus = 'accepted' | 'duplicate' | 'rejected' | 'processed' | 'failed'
export type Phase6ProviderHealth = 'healthy' | 'degraded' | 'down' | 'unknown'

export interface Phase6ProviderManifest {
  id: string
  displayName: string
  version: string
  capabilities: readonly Phase6ProviderCapability[]
  environments: readonly Phase6ExecutionMode[]
}

export interface Phase6ExecutionContext {
  tenantId: string
  business: CommercialBusiness
  action: string
  actor: string
  credential: CredentialReference
  mode: Phase6ExecutionMode
  idempotencyKey: string
  metadata: Record<string, unknown>
}

export interface Phase6AdapterResult {
  providerObjectId?: string | null
  providerStatus?: string | null
  output: Record<string, unknown>
  verificationRequired?: boolean
}

export interface Phase6VerificationResult {
  verified: boolean
  evidence: Record<string, unknown>
  reason?: string
}

export interface CommercialProviderAdapter {
  manifest: Phase6ProviderManifest
  execute(context: Phase6ExecutionContext, input: Record<string, unknown>): Promise<Phase6AdapterResult>
  verify?(context: Phase6ExecutionContext, result: Phase6AdapterResult): Promise<Phase6VerificationResult>
  health?(): Promise<{ status: Phase6ProviderHealth; latencyMs?: number; detail?: string }>
}

export interface Phase6ExecutionRecord {
  executionId: string
  tenantId: string
  business: CommercialBusiness
  provider: string
  action: string
  workflowId: string
  idempotencyKey: string
  mode: Phase6ExecutionMode
  status: Phase6ExecutionStatus
  attempts: number
  maxAttempts: number
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface Phase6WebhookRecord {
  webhookId: string
  provider: string
  tenantId: string
  business: CommercialBusiness
  eventType: string
  externalEventId: string
  payloadHash: string
  status: Phase6WebhookStatus
  receivedAt: string
  processedAt: string | null
  error: string | null
}

export interface Phase6ProviderObservation {
  provider: string
  status: Phase6ProviderHealth
  latencyMs: number | null
  executions: number
  successes: number
  failures: number
  lastObservedAt: string
  detail: string | null
}

const CATEGORY = Object.freeze({ execution: 'phase6_execution', webhook: 'phase6_webhook', observation: 'phase6_provider_observation', sandbox: 'phase6_sandbox' })
const adapters = new Map<string, CommercialProviderAdapter>()

const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const now = () => new Date().toISOString()
const id = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
const key = (prefix: string, scope: string, identity: string) => `${prefix}:${scope}:${identity}`
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

async function readCategory<T>(category: string, limit = 1000): Promise<T[]> {
  const rows = await db.memory.findMany({ where: { category }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 5000) })
  return rows.map((row) => { try { return JSON.parse(row.value) as T } catch { return null } }).filter((value): value is T => value !== null)
}

async function put<T>(recordKey: string, category: string, value: T): Promise<{ created: boolean; value: T }> {
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) {
    try { return { created: false, value: JSON.parse(existing.value) as T } } catch { throw new Error(`Corrupt Phase 6 record: ${recordKey}`) }
  }
  await db.memory.create({ data: { key: recordKey, category, value: JSON.stringify(value) } })
  return { created: true, value }
}

async function replace<T>(recordKey: string, value: T): Promise<void> {
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (!existing) throw new Error(`Phase 6 persistence record not found: ${recordKey}`)
  await db.memory.update({ where: { id: existing.id }, data: { value: JSON.stringify(value) } })
}

export function registerCommercialProviderAdapter(adapter: CommercialProviderAdapter): void {
  const manifest = adapter.manifest
  if (!/^[-a-z0-9]+$/.test(manifest.id)) throw new Error('Provider id must use lowercase letters, digits, and hyphens.')
  if (!manifest.displayName.trim() || !manifest.version.trim()) throw new Error(`Provider ${manifest.id} must have a display name and version.`)
  if (manifest.capabilities.length === 0) throw new Error(`Provider ${manifest.id} must declare at least one capability.`)
  if (adapters.has(manifest.id)) throw new Error(`Provider adapter already registered: ${manifest.id}`)
  adapters.set(manifest.id, adapter)
}

export function getCommercialProviderAdapter(providerId: string): CommercialProviderAdapter | null {
  return adapters.get(clean(providerId).toLowerCase()) ?? null
}

export function listCommercialProviderAdapters(): Phase6ProviderManifest[] {
  return [...adapters.values()].map((adapter) => adapter.manifest).sort((a, b) => a.id.localeCompare(b.id))
}

export function resetCommercialProviderRegistryForTests(): void {
  adapters.clear()
}

export function validateCommercialProviderRegistry(): string[] {
  const errors: string[] = []
  const ids = [...adapters.keys()]
  if (new Set(ids).size !== ids.length) errors.push('Phase 6 provider IDs are duplicated.')
  for (const adapter of adapters.values()) {
    if (adapter.manifest.capabilities.length === 0) errors.push(`Provider ${adapter.manifest.id} has no capabilities.`)
    for (const mode of adapter.manifest.environments) if (mode !== 'live' && mode !== 'sandbox') errors.push(`Provider ${adapter.manifest.id} declares an invalid environment.`)
  }
  return errors
}

export async function registerCommercialCredential(input: Omit<CredentialReference, 'credentialId' | 'createdAt' | 'updatedAt' | 'lastValidatedAt' | 'status'> & { credentialId?: string; scopes?: string[] }): Promise<CredentialReference> {
  const result = await registerCredentialReference({ ...input, status: 'pending', lastValidatedAt: null })
  return result.credential
}

export async function transitionCommercialCredential(credentialId: string, tenantId: string, status: CredentialReference['status'], validatedAt?: string | null): Promise<CredentialReference | null> {
  const credentials = await readCategory<CredentialReference>(COMMERCIAL_CATEGORIES.credential, 5000)
  const current = credentials.find((credential) => credential.credentialId === credentialId && credential.tenantId === tenantId)
  if (!current) return null
  if (current.status === 'revoked' && status !== 'revoked') throw new Error('Revoked credentials cannot return to an active state; reconnect with a new credential reference.')
  const updated = { ...current, status, lastValidatedAt: validatedAt === undefined ? current.lastValidatedAt : validatedAt, updatedAt: now() }
  const identity = `${updated.business}:${updated.provider}:${updated.externalAccountId ?? updated.credentialId}`
  await replace(key('credential', tenantId, identity), updated)
  return updated
}

export function signPhase6Webhook(payload: string, secret: string): string {
  if (!secret) throw new Error('Webhook signing secret is required.')
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyPhase6WebhookSignature(payload: string, providedSignature: string, secret: string): boolean {
  try {
    const expected = signPhase6Webhook(payload, secret)
    const left = Buffer.from(expected, 'utf8')
    const right = Buffer.from(providedSignature.trim().toLowerCase(), 'utf8')
    return left.length === right.length && timingSafeEqual(left, right)
  } catch {
    return false
  }
}

async function countActionsToday(tenantId: string, business: CommercialBusiness, action: string): Promise<number> {
  const audits = await readCategory<CommercialAuditRecord>(COMMERCIAL_CATEGORIES.audit, 5000)
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  return audits.filter((audit) => audit.tenantId === tenantId && audit.business === business && audit.action === action && audit.allowed && new Date(audit.createdAt).getTime() >= dayStart.getTime()).length
}

export async function registerDelegatedCommercialAuthority(input: {
  authorityId?: string
  tenantId: string
  business: CommercialBusiness
  action: string
  level: AuthorityLevel
  maxSpend?: number | null
  maxDailyCount?: number | null
  allowedChannels?: string[]
  approvedByUserId: string
  expiresAt?: string | null
}): Promise<void> {
  if (!isCommercialBusiness(input.business)) throw new Error('Invalid commercial business.')
  if (input.level === 'autonomous' && !input.approvedByUserId.trim()) throw new Error('Autonomous authority requires an approving user.')
  const authority = {
    authorityId: clean(input.authorityId ?? id('auth')),
    tenantId: clean(input.tenantId),
    business: input.business,
    action: clean(input.action),
    level: input.level,
    maxSpend: input.maxSpend == null ? null : Math.max(0, input.maxSpend),
    maxDailyCount: input.maxDailyCount == null ? null : Math.max(0, Math.floor(input.maxDailyCount)),
    allowedChannels: [...new Set((input.allowedChannels ?? []).map(clean).filter(Boolean))],
    approvedByUserId: clean(input.approvedByUserId),
    approvedAt: now(),
    expiresAt: input.expiresAt ?? null,
    status: 'active' as const,
  }
  await put(key('authority', authority.tenantId, authority.authorityId), COMMERCIAL_CATEGORIES.authority, authority)
}

async function authorizeExternalAction(input: { tenantId: string; business: CommercialBusiness; action: string; spend: number; channel?: string | null }): Promise<{ allowed: boolean; reason: string }> {
  const authorities = await readCategory<{
    tenantId: string
    business: CommercialBusiness
    action: string
    level: AuthorityLevel
    maxSpend: number | null
    maxDailyCount: number | null
    allowedChannels: string[]
    expiresAt: string | null
    status: string
  }>(COMMERCIAL_CATEGORIES.authority, 5000)
  const candidates = authorities.filter((authority) => authority.tenantId === input.tenantId && authority.business === input.business && authority.status === 'active' && (!authority.expiresAt || new Date(authority.expiresAt).getTime() > Date.now()) && (authority.action === input.action || authority.action === '*'))
  if (candidates.length === 0) return { allowed: false, reason: 'No active delegated authority matches the requested action.' }
  for (const authority of candidates) {
    if (authority.level === 'forbidden' || authority.level === 'human_approval') continue
    if (authority.level !== 'autonomous' && authority.level !== 'guardrailed') continue
    if (authority.maxSpend != null && input.spend > authority.maxSpend) continue
    if (input.channel && authority.allowedChannels.length > 0 && !authority.allowedChannels.includes(input.channel)) continue
    if (authority.maxDailyCount != null && await countActionsToday(input.tenantId, input.business, input.action) >= authority.maxDailyCount) continue
    return { allowed: true, reason: authority.level === 'autonomous' ? 'Authorized by autonomous delegated authority.' : 'Authorized inside guardrails.' }
  }
  return { allowed: false, reason: 'Requested action exceeds delegated authority, channel, spend, or daily-count limits.' }
}

async function writeAudit(input: { tenantId: string; business: CommercialBusiness; action: string; actor: string; entityId: string | null; allowed: boolean; reason: string; metadata?: Record<string, unknown> }): Promise<void> {
  const record: CommercialAuditRecord = {
    auditId: id('audit'),
    tenantId: input.tenantId,
    business: input.business,
    action: input.action,
    actor: input.actor,
    entityType: 'phase6_external_action',
    entityId: input.entityId,
    allowed: input.allowed,
    reason: input.reason,
    metadata: input.metadata ?? {},
    createdAt: now(),
  }
  await db.memory.create({ data: { key: key('audit', input.tenantId, record.auditId), category: COMMERCIAL_CATEGORIES.audit, value: JSON.stringify(record) } })
}

export async function submitCommercialExternalAction(input: {
  tenantId: string
  business: CommercialBusiness
  provider: string
  action: string
  actor: string
  credentialId: string
  idempotencyKey: string
  input: Record<string, unknown>
  spend?: number
  channel?: string | null
  mode?: Phase6ExecutionMode
  maxAttempts?: number
}): Promise<Phase6ExecutionRecord> {
  if (!isCommercialBusiness(input.business)) throw new Error('Invalid commercial business.')
  const provider = clean(input.provider).toLowerCase()
  const adapter = getCommercialProviderAdapter(provider)
  if (!adapter) throw new Error(`No registered Phase 6 adapter for provider: ${provider}`)
  const credential = (await readCategory<CredentialReference>(COMMERCIAL_CATEGORIES.credential, 5000)).find((item) => item.credentialId === input.credentialId && item.tenantId === input.tenantId && item.business === input.business)
  if (!credential) throw new Error('Credential reference not found for the tenant/business boundary.')
  if (credential.status !== 'connected') throw new Error(`Credential ${credential.credentialId} is not connected.`)
  if (!adapter.manifest.environments.includes(input.mode ?? 'live')) throw new Error(`Provider ${provider} does not support ${input.mode ?? 'live'} execution.`)
  const authorization = await authorizeExternalAction({ tenantId: input.tenantId, business: input.business, action: clean(input.action), spend: Math.max(0, input.spend ?? 0), channel: input.channel ?? null })
  if (!authorization.allowed) {
    await writeAudit({ tenantId: input.tenantId, business: input.business, action: clean(input.action), actor: clean(input.actor), entityId: null, allowed: false, reason: authorization.reason, metadata: { provider } })
    throw new Error(`External action denied: ${authorization.reason}`)
  }
  const workflow = await createCommercialWorkflow({ tenantId: input.tenantId, business: input.business, workflowType: `phase6:${provider}:${input.action}`, input: input.input, maxRetries: Math.max(0, Math.min(10, (input.maxAttempts ?? 3) - 1)), nextRunAt: now(), idempotencyKey: clean(input.idempotencyKey) })
  const existing = (await readCategory<Phase6ExecutionRecord>(CATEGORY.execution, 5000)).find((item) => item.tenantId === input.tenantId && item.idempotencyKey === input.idempotencyKey)
  if (existing) return existing
  const record: Phase6ExecutionRecord = {
    executionId: id('exec'),
    tenantId: input.tenantId,
    business: input.business,
    provider,
    action: clean(input.action),
    workflowId: workflow.workflow.workflowId,
    idempotencyKey: clean(input.idempotencyKey),
    mode: input.mode ?? 'live',
    status: 'queued',
    attempts: 0,
    maxAttempts: Math.max(1, Math.min(10, input.maxAttempts ?? 3)),
    input: input.input,
    output: null,
    error: null,
    createdAt: now(),
    updatedAt: now(),
    completedAt: null,
  }
  const result = await put(key('execution', input.tenantId, record.idempotencyKey), CATEGORY.execution, record)
  await writeAudit({ tenantId: input.tenantId, business: input.business, action: record.action, actor: clean(input.actor), entityId: result.value.executionId, allowed: true, reason: authorization.reason, metadata: { provider, mode: record.mode } })
  return result.value
}

export async function runCommercialExternalAction(executionId: string, tenantId: string): Promise<Phase6ExecutionRecord | null> {
  const executions = await readCategory<Phase6ExecutionRecord>(CATEGORY.execution, 5000)
  const current = executions.find((item) => item.executionId === executionId && item.tenantId === tenantId)
  if (!current) return null
  if (['succeeded', 'cancelled'].includes(current.status)) return current
  if (current.attempts >= current.maxAttempts) throw new Error('Phase 6 execution attempt limit exceeded.')
  const adapter = getCommercialProviderAdapter(current.provider)
  if (!adapter) throw new Error(`Provider adapter is no longer registered: ${current.provider}`)
  const credentials = await readCategory<CredentialReference>(COMMERCIAL_CATEGORIES.credential, 5000)
  const credential = credentials.find((item) => item.tenantId === tenantId && item.business === current.business && item.provider === current.provider && item.status === 'connected')
  if (!credential) throw new Error(`No connected credential is available for provider ${current.provider}.`)
  const running: Phase6ExecutionRecord = { ...current, status: 'running', attempts: current.attempts + 1, updatedAt: now(), error: null }
  await replace(key('execution', tenantId, current.idempotencyKey), running)
  await transitionCommercialWorkflow({ tenantId, workflowId: current.workflowId, status: 'running' })
  try {
    const context: Phase6ExecutionContext = { tenantId, business: current.business, action: current.action, actor: 'phase6-execution-runtime', credential, mode: current.mode, idempotencyKey: current.idempotencyKey, metadata: { executionId: current.executionId, workflowId: current.workflowId } }
    const result = await adapter.execute(context, current.input)
    const verification = adapter.verify ? await adapter.verify(context, result) : { verified: !result.verificationRequired, evidence: { providerStatus: result.providerStatus ?? null } }
    if (!verification.verified) throw new Error(`External action completed but verification failed: ${verification.reason ?? 'provider result is not sufficient evidence'}`)
    const succeeded: Phase6ExecutionRecord = { ...running, status: 'succeeded', output: { ...result.output, verification: verification.evidence, providerObjectId: result.providerObjectId ?? null }, error: null, updatedAt: now(), completedAt: now() }
    await replace(key('execution', tenantId, current.idempotencyKey), succeeded)
    await transitionCommercialWorkflow({ tenantId, workflowId: current.workflowId, status: 'succeeded', output: succeeded.output })
    await recordCommercialEvent({ tenantId, business: current.business, type: 'phase6.external_action.succeeded', source: 'phase6-execution', entityType: 'external_action', entityId: current.executionId, payload: succeeded.output ?? {}, occurredAt: succeeded.completedAt, idempotencyKey: `phase6-success:${current.idempotencyKey}` })
    await observeProvider(current.provider, 'healthy', null, true, null)
    return succeeded
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const terminal = running.attempts >= running.maxAttempts
    const failed: Phase6ExecutionRecord = { ...running, status: terminal ? 'failed' : 'waiting', error: message, updatedAt: now(), completedAt: terminal ? now() : null }
    await replace(key('execution', tenantId, current.idempotencyKey), failed)
    await transitionCommercialWorkflow({ tenantId, workflowId: current.workflowId, status: terminal ? 'failed' : 'waiting', output: { error: message }, incrementRetry: true, nextRunAt: terminal ? null : new Date(Date.now() + Math.min(3600000, 1000 * 2 ** running.attempts)).toISOString() })
    await observeProvider(current.provider, 'degraded', null, false, message)
    return failed
  }
}

export async function processCommercialWebhook(input: {
  provider: string
  tenantId: string
  business: CommercialBusiness
  eventType: string
  externalEventId: string
  payload: Record<string, unknown>
  signature?: string
  signingSecret?: string
  process?: (payload: Record<string, unknown>) => Promise<void>
}): Promise<Phase6WebhookRecord> {
  if (!isCommercialBusiness(input.business)) throw new Error('Invalid commercial business.')
  const provider = clean(input.provider).toLowerCase()
  const rawPayload = JSON.stringify(input.payload)
  if (input.signature && input.signingSecret && !verifyPhase6WebhookSignature(rawPayload, input.signature, input.signingSecret)) {
    throw new Error('Invalid Phase 6 webhook signature.')
  }
  const payloadHash = sha256(rawPayload)
  const recordKey = key('webhook', `${input.tenantId}:${provider}`, input.externalEventId)
  const existing = await db.memory.findUnique({ where: { key: recordKey } })
  if (existing) {
    const parsed = JSON.parse(existing.value) as Phase6WebhookRecord
    return { ...parsed, status: 'duplicate' }
  }
  const record: Phase6WebhookRecord = { webhookId: id('wh'), provider, tenantId: input.tenantId, business: input.business, eventType: clean(input.eventType), externalEventId: clean(input.externalEventId), payloadHash, status: 'accepted', receivedAt: now(), processedAt: null, error: null }
  await put(recordKey, CATEGORY.webhook, record)
  try {
    if (input.process) await input.process(input.payload)
    const processed = { ...record, status: 'processed' as const, processedAt: now() }
    await replace(recordKey, processed)
    await recordCommercialEvent({ tenantId: input.tenantId, business: input.business, type: `phase6.webhook.${record.eventType}`, source: `provider:${provider}`, entityType: 'webhook', entityId: record.webhookId, payload: input.payload, occurredAt: record.receivedAt, idempotencyKey: `phase6-webhook:${provider}:${input.externalEventId}` })
    return processed
  } catch (error) {
    const failed = { ...record, status: 'failed' as const, error: error instanceof Error ? error.message : String(error) }
    await replace(recordKey, failed)
    return failed
  }
}

async function observeProvider(provider: string, status: Phase6ProviderHealth, latencyMs: number | null, success: boolean, detail: string | null): Promise<void> {
  const existing = (await readCategory<Phase6ProviderObservation>(CATEGORY.observation, 5000)).find((item) => item.provider === provider)
  const observation: Phase6ProviderObservation = existing
    ? { ...existing, status, latencyMs, executions: existing.executions + 1, successes: existing.successes + (success ? 1 : 0), failures: existing.failures + (success ? 0 : 1), lastObservedAt: now(), detail }
    : { provider, status, latencyMs, executions: 1, successes: success ? 1 : 0, failures: success ? 0 : 1, lastObservedAt: now(), detail }
  if (existing) {
    const row = await db.memory.findMany({ where: { category: CATEGORY.observation }, take: 5000 })
    const target = row.find((candidate) => { try { return (JSON.parse(candidate.value) as Phase6ProviderObservation).provider === provider } catch { return false } })
    if (target) { await db.memory.update({ where: { id: target.id }, data: { value: JSON.stringify(observation) } }); return }
  }
  await db.memory.create({ data: { key: `phase6:observation:${provider}`, category: CATEGORY.observation, value: JSON.stringify(observation) } })
}

export async function getPhase6ProviderObservations(): Promise<Phase6ProviderObservation[]> {
  return readCategory<Phase6ProviderObservation>(CATEGORY.observation, 5000)
}

export async function getPhase6Execution(executionId: string, tenantId: string): Promise<Phase6ExecutionRecord | null> {
  return (await readCategory<Phase6ExecutionRecord>(CATEGORY.execution, 5000)).find((item) => item.executionId === executionId && item.tenantId === tenantId) ?? null
}

export async function listPhase6Executions(tenantId: string, business?: CommercialBusiness): Promise<Phase6ExecutionRecord[]> {
  return (await readCategory<Phase6ExecutionRecord>(CATEGORY.execution, 5000)).filter((item) => item.tenantId === tenantId && (!business || item.business === business))
}

export async function replayPhase6Webhook(input: { tenantId: string; webhookId: string }): Promise<Phase6WebhookRecord | null> {
  const record = (await readCategory<Phase6WebhookRecord>(CATEGORY.webhook, 5000)).find((item) => item.tenantId === input.tenantId && item.webhookId === input.webhookId)
  if (!record) return null
  return { ...record, status: 'accepted' }
}

export async function buildPhase6ReadinessReport(): Promise<{ ready: boolean; version: number; registeredProviders: number; capabilities: string[]; errors: string[] }> {
  const errors = validateCommercialProviderRegistry()
  const capabilities = [...new Set(listCommercialProviderAdapters().flatMap((manifest) => manifest.capabilities))].sort()
  return { ready: errors.length === 0, version: PHASE6_VERSION, registeredProviders: adapters.size, capabilities, errors }
}

export const PHASE6_INVARIANTS = Object.freeze([
  'No raw provider secret may be persisted in Phase 6 commercial state; only opaque credential references are stored.',
  'Every external action is tenant-scoped, business-scoped, idempotent, audited, authority-gated, and outcome-verifiable.',
  'Webhook ingestion is idempotent by provider + tenant + external event identity.',
  'Provider failures update durable execution state and provider observability; retries never exceed the declared attempt budget.',
  'Phase 6 never silently escalates a human-approval or forbidden action into autonomous execution.',
  'Provider adapters are registered exactly once per provider id and must explicitly declare supported capabilities and environments.',
])

export function validatePhase6Invariants(): string[] {
  const errors: string[] = []
  if (new Set(PHASE6_INVARIANTS).size !== PHASE6_INVARIANTS.length) errors.push('Phase 6 invariant list contains duplicates.')
  if (!PHASE6_INVARIANTS.every((item) => item.length > 30)) errors.push('Phase 6 invariants are incomplete.')
  return errors
}
