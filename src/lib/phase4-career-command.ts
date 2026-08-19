import { randomUUID } from 'node:crypto'
import { db } from './db'
import {
  COMMERCIAL_CONTROL_PLANE_ID,
  COMMERCIAL_CONTROL_PLANE_VERSION,
  recordCommercialEvent,
  createCommercialWorkflow,
  type CommercialBusiness,
} from './commercial-control-plane'

export const PHASE4_VERSION = '1.0.0'
export const PHASE4_NAME = 'Career Command Center'
export const PHASE4_BUSINESS: CommercialBusiness = 'career-command'

export const CAREER_STAGES = [
  'profile',
  'discover',
  'organize',
  'prepare',
  'user-approval',
  'submit',
  'track',
  'learn',
] as const

export type CareerStage = (typeof CAREER_STAGES)[number]

export type CareerApplicationStatus =
  | 'draft'
  | 'ready'
  | 'approval_pending'
  | 'approved'
  | 'submitted'
  | 'tracking'
  | 'closed'
  | 'cancelled'

export interface CareerApplicationInput {
  tenantId: string
  userId: string
  company: string
  roleTitle: string
  jobUrl?: string
  source?: string
  resumeRef?: string
  coverLetterRef?: string
  notes?: string
  idempotencyKey: string
}

export interface CareerApplication {
  applicationId: string
  tenantId: string
  userId: string
  business: typeof PHASE4_BUSINESS
  company: string
  roleTitle: string
  jobUrl: string | null
  source: string | null
  resumeRef: string | null
  coverLetterRef: string | null
  notes: string | null
  status: CareerApplicationStatus
  stage: CareerStage
  createdAt: string
  updatedAt: string
  controlPlaneId: typeof COMMERCIAL_CONTROL_PLANE_ID
  controlPlaneVersion: number
}

export interface CareerApproval {
  approvalId: string
  applicationId: string
  tenantId: string
  userId: string
  approvedByUserId: string
  approvedAt: string
  expiresAt: string | null
  status: 'active' | 'consumed' | 'revoked' | 'expired'
  action: 'submit_external_application'
  createdAt: string
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function applicationKey(tenantId: string, idempotencyKey: string): string {
  return `phase4:application:${tenantId}:${idempotencyKey}`
}

function approvalKey(applicationId: string, approvalId: string): string {
  return `phase4:approval:${applicationId}:${approvalId}`
}

function parse<T>(value: string, key: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`Corrupt Phase 4 record: ${key}`)
  }
}

export function validateCareerStageTransition(from: CareerStage, to: CareerStage): boolean {
  const fromIndex = CAREER_STAGES.indexOf(from)
  const toIndex = CAREER_STAGES.indexOf(to)
  return fromIndex >= 0 && toIndex === fromIndex + 1
}

export function validateCareerApplicationTransition(from: CareerApplicationStatus, to: CareerApplicationStatus): boolean {
  const allowed: Record<CareerApplicationStatus, CareerApplicationStatus[]> = {
    draft: ['ready', 'cancelled'],
    ready: ['approval_pending', 'cancelled'],
    approval_pending: ['approved', 'cancelled'],
    approved: ['submitted', 'cancelled'],
    submitted: ['tracking', 'closed'],
    tracking: ['closed'],
    closed: [],
    cancelled: [],
  }
  return allowed[from].includes(to)
}

export async function createCareerApplication(input: CareerApplicationInput): Promise<{ created: boolean; application: CareerApplication }> {
  const tenantId = clean(input.tenantId)
  const userId = clean(input.userId)
  const company = clean(input.company)
  const roleTitle = clean(input.roleTitle)
  const idempotencyKey = clean(input.idempotencyKey)
  if (!tenantId || !userId || !company || !roleTitle || !idempotencyKey) {
    throw new Error('tenantId, userId, company, roleTitle, and idempotencyKey are required')
  }
  const key = applicationKey(tenantId, idempotencyKey)
  const existing = await db.memory.findUnique({ where: { key } })
  if (existing) return { created: false, application: parse<CareerApplication>(existing.value, key) }

  const now = new Date().toISOString()
  const application: CareerApplication = {
    applicationId: `careerapp_${randomUUID()}`,
    tenantId,
    userId,
    business: PHASE4_BUSINESS,
    company,
    roleTitle,
    jobUrl: input.jobUrl?.trim() || null,
    source: input.source?.trim() || null,
    resumeRef: input.resumeRef?.trim() || null,
    coverLetterRef: input.coverLetterRef?.trim() || null,
    notes: input.notes?.trim() || null,
    status: 'draft',
    stage: 'profile',
    createdAt: now,
    updatedAt: now,
    controlPlaneId: COMMERCIAL_CONTROL_PLANE_ID,
    controlPlaneVersion: COMMERCIAL_CONTROL_PLANE_VERSION,
  }

  await recordCommercialEvent({
    tenantId,
    business: PHASE4_BUSINESS,
    type: 'career.application.created',
    source: 'phase4-career-command',
    entityType: 'career_application',
    entityId: application.applicationId,
    payload: { applicationId: application.applicationId, company, roleTitle },
    occurredAt: now,
    idempotencyKey,
  })
  try {
    await db.memory.create({ data: { key, category: 'phase4_career_application', value: JSON.stringify(application) } })
    return { created: true, application }
  } catch (error) {
    const concurrent = await db.memory.findUnique({ where: { key } })
    if (concurrent) return { created: false, application: parse<CareerApplication>(concurrent.value, key) }
    throw error
  }
}

export async function requestCareerApplicationApproval(applicationId: string, tenantId: string, userId: string): Promise<{ application: CareerApplication; approval: CareerApproval }> {
  const id = clean(applicationId)
  const tenant = clean(tenantId)
  const owner = clean(userId)
  if (!id || !tenant || !owner) throw new Error('applicationId, tenantId, and userId are required')

  const records = await db.memory.findMany({ where: { category: 'phase4_career_application' }, take: 5000 })
  const applicationRecord = records.find((record) => parse<CareerApplication>(record.value, record.key).applicationId === id)
  if (!applicationRecord) throw new Error(`Career application ${id} was not found`)
  const application = parse<CareerApplication>(applicationRecord.value, applicationRecord.key)
  if (application.tenantId !== tenant || application.userId !== owner) throw new Error('Career application owner mismatch')
  if (!validateCareerApplicationTransition(application.status, 'approval_pending')) throw new Error(`Cannot request approval from status ${application.status}`)

  const now = new Date().toISOString()
  const approval: CareerApproval = {
    approvalId: `approval_${randomUUID()}`,
    applicationId: application.applicationId,
    tenantId: application.tenantId,
    userId: application.userId,
    approvedByUserId: application.userId,
    approvedAt: now,
    expiresAt: null,
    status: 'active',
    action: 'submit_external_application',
    createdAt: now,
  }
  application.status = 'approval_pending'
  application.stage = 'user-approval'
  application.updatedAt = now

  await db.memory.create({ data: { key: approvalKey(application.applicationId, approval.approvalId), category: 'phase4_career_approval', value: JSON.stringify(approval) } })
  await db.memory.update({ where: { key: applicationRecord.key }, data: { value: JSON.stringify(application) } })
  await recordCommercialEvent({
    tenantId: application.tenantId,
    business: PHASE4_BUSINESS,
    type: 'career.application.approval_requested',
    source: 'phase4-career-command',
    entityType: 'career_application',
    entityId: application.applicationId,
    payload: { approvalId: approval.approvalId },
    occurredAt: now,
    idempotencyKey: `approval-request:${approval.applicationId}`,
  })
  return { application, approval }
}

/**
 * Records an explicit user authorization. This is the only path that may make
 * an external application eligible for submission.
 */
export async function approveCareerApplication(approvalId: string, tenantId: string, userId: string): Promise<CareerApproval> {
  const id = clean(approvalId)
  const tenant = clean(tenantId)
  const owner = clean(userId)
  if (!id || !tenant || !owner) throw new Error('approvalId, tenantId, and userId are required')

  const record = await db.memory.findFirst({ where: { category: 'phase4_career_approval' }, take: 5000 })
  const records = record ? await db.memory.findMany({ where: { category: 'phase4_career_approval' }, take: 5000 }) : []
  const matching = records.find((item) => parse<CareerApproval>(item.value, item.key).approvalId === id)
  if (!matching) throw new Error(`Approval ${id} was not found`)
  const approval = parse<CareerApproval>(matching.value, matching.key)
  if (approval.tenantId !== tenant || approval.userId !== owner || approval.approvedByUserId !== owner) throw new Error('Career approval owner mismatch')
  if (approval.status !== 'active') throw new Error(`Approval is ${approval.status}`)
  approval.approvedAt = new Date().toISOString()
  approval.status = 'active'
  await db.memory.update({ where: { key: matching.key }, data: { value: JSON.stringify(approval) } })

  const applicationRecords = await db.memory.findMany({ where: { category: 'phase4_career_application' }, take: 5000 })
  const applicationRecord = applicationRecords.find((item) => parse<CareerApplication>(item.value, item.key).applicationId === approval.applicationId)
  if (!applicationRecord) throw new Error(`Career application ${approval.applicationId} was not found`)
  const application = parse<CareerApplication>(applicationRecord.value, applicationRecord.key)
  if (application.tenantId !== tenant || application.userId !== owner) throw new Error('Career application owner mismatch')
  if (!validateCareerApplicationTransition(application.status, 'approved')) throw new Error(`Cannot approve application from status ${application.status}`)

  const now = new Date().toISOString()
  application.status = 'approved'
  application.updatedAt = now
  await db.memory.update({ where: { key: applicationRecord.key }, data: { value: JSON.stringify(application) } })
  await recordCommercialEvent({
    tenantId: application.tenantId,
    business: PHASE4_BUSINESS,
    type: 'career.application.approved',
    source: 'phase4-career-command',
    entityType: 'career_application',
    entityId: application.applicationId,
    payload: { approvalId: approval.approvalId, approvedByUserId: owner },
    occurredAt: now,
    idempotencyKey: `approval:${approval.approvalId}`,
  })
  return approval
}

export async function prepareCareerApplication(applicationId: string, tenantId: string, userId: string, resumeRef: string, coverLetterRef?: string): Promise<CareerApplication> {
  const id = clean(applicationId)
  const tenant = clean(tenantId)
  const owner = clean(userId)
  const resume = clean(resumeRef)
  if (!id || !tenant || !owner || !resume) throw new Error('applicationId, tenantId, userId, and resumeRef are required')
  const records = await db.memory.findMany({ where: { category: 'phase4_career_application' }, take: 5000 })
  const record = records.find((item) => parse<CareerApplication>(item.value, item.key).applicationId === id)
  if (!record) throw new Error(`Career application ${id} was not found`)
  const application = parse<CareerApplication>(record.value, record.key)
  if (application.tenantId !== tenant || application.userId !== owner) throw new Error('Career application owner mismatch')
  if (!['draft', 'ready'].includes(application.status)) throw new Error(`Cannot prepare application from status ${application.status}`)
  application.resumeRef = resume
  application.coverLetterRef = coverLetterRef?.trim() || application.coverLetterRef
  application.status = 'ready'
  application.stage = 'prepare'
  application.updatedAt = new Date().toISOString()
  await db.memory.update({ where: { key: record.key }, data: { value: JSON.stringify(application) } })
  return application
}

export async function submitCareerApplication(applicationId: string, tenantId: string, userId: string): Promise<CareerApplication> {
  const id = clean(applicationId)
  const tenant = clean(tenantId)
  const owner = clean(userId)
  if (!id || !tenant || !owner) throw new Error('applicationId, tenantId, and userId are required')
  const applications = await db.memory.findMany({ where: { category: 'phase4_career_application' }, take: 5000 })
  const record = applications.find((item) => parse<CareerApplication>(item.value, item.key).applicationId === id)
  if (!record) throw new Error(`Career application ${id} was not found`)
  const application = parse<CareerApplication>(record.value, record.key)
  if (application.tenantId !== tenant || application.userId !== owner) throw new Error('Career application owner mismatch')
  if (application.status !== 'approved') throw new Error('External application submission requires active user approval')

  const approvals = await db.memory.findMany({ where: { category: 'phase4_career_approval' }, take: 5000 })
  const approvalRecord = approvals.find((item) => {
    const approval = parse<CareerApproval>(item.value, item.key)
    return approval.applicationId === application.applicationId && approval.status === 'active' && approval.tenantId === tenant && approval.userId === owner && approval.approvedByUserId === owner && approval.action === 'submit_external_application'
  })
  if (!approvalRecord) throw new Error('No active durable user approval exists for external submission')

  const now = new Date().toISOString()
  application.status = 'submitted'
  application.stage = 'submit'
  application.updatedAt = now
  await db.memory.update({ where: { key: record.key }, data: { value: JSON.stringify(application) } })
  const approval = parse<CareerApproval>(approvalRecord.value, approvalRecord.key)
  approval.status = 'consumed'
  await db.memory.update({ where: { key: approvalRecord.key }, data: { value: JSON.stringify(approval) } })
  await recordCommercialEvent({
    tenantId: application.tenantId,
    business: PHASE4_BUSINESS,
    type: 'career.application.submitted',
    source: 'phase4-career-command',
    entityType: 'career_application',
    entityId: application.applicationId,
    payload: { approvalId: approval.approvalId },
    occurredAt: now,
    idempotencyKey: `submit:${application.applicationId}:${approval.approvalId}`,
  })
  await createCommercialWorkflow({
    tenantId: application.tenantId,
    business: PHASE4_BUSINESS,
    workflowType: 'career-application-tracking',
    input: { applicationId: application.applicationId },
    maxRetries: 2,
    nextRunAt: now,
    idempotencyKey: `career-track:${application.applicationId}`,
  })
  return application
}

export function validatePhase4Contracts(): string[] {
  const errors: string[] = []
  if (PHASE4_BUSINESS !== 'career-command') errors.push('invalid phase4 business')
  if (CAREER_STAGES.length !== 8) errors.push('career stage count drift')
  for (let index = 0; index < CAREER_STAGES.length - 1; index += 1) {
    if (!validateCareerStageTransition(CAREER_STAGES[index], CAREER_STAGES[index + 1])) errors.push(`invalid career stage transition at ${index}`)
  }
  if (!validateCareerApplicationTransition('draft', 'ready')) errors.push('draft readiness transition missing')
  if (validateCareerApplicationTransition('approved', 'tracking')) errors.push('invalid approval bypass exists')
  if (validateCareerApplicationTransition('submitted', 'draft')) errors.push('terminal rollback exists')
  return errors
}
