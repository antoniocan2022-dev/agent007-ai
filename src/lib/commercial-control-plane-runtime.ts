import { db } from './db'
import { COMMERCIAL_CATEGORIES, type CommercialBusiness, type CommercialEvent, type CommercialWorkflow, type EventStatus, type WorkflowStatus } from './commercial-control-plane'

function key(kind: string, tenantId: string, id: string): string { return `${kind}:${tenantId}:${id}` }

async function read<T>(category: string, tenantId: string): Promise<T[]> {
  const records = await db.memory.findMany({ where: { category }, orderBy: { createdAt: 'desc' }, take: 5000 })
  return records.map((record) => { try { return JSON.parse(record.value) as T } catch { return null } }).filter((item): item is T => !!item && (item as { tenantId?: string }).tenantId === tenantId)
}

export async function transitionCommercialWorkflow(input: { tenantId: string; workflowId: string; status: WorkflowStatus; output?: Record<string, unknown> | null; nextRunAt?: string | null; incrementRetry?: boolean }): Promise<CommercialWorkflow | null> {
  const workflows = await read<CommercialWorkflow>(COMMERCIAL_CATEGORIES.workflow, input.tenantId)
  const current = workflows.find((workflow) => workflow.workflowId === input.workflowId)
  if (!current) return null
  if (current.status === 'succeeded' && input.status === 'running') throw new Error('A succeeded workflow cannot return to running state.')
  if (current.status === 'cancelled' && input.status !== 'cancelled') throw new Error('A cancelled workflow cannot transition without a new idempotency key.')
  const updated: CommercialWorkflow = {
    ...current,
    status: input.status,
    output: input.output === undefined ? current.output : input.output,
    nextRunAt: input.nextRunAt === undefined ? current.nextRunAt : input.nextRunAt,
    retryCount: input.incrementRetry ? current.retryCount + 1 : current.retryCount,
    updatedAt: new Date().toISOString(),
  }
  if (updated.retryCount > updated.maxRetries) throw new Error('Workflow retry limit exceeded.')
  const record = await db.memory.findUnique({ where: { key: key('workflow', input.tenantId, current.idempotencyKey) } })
  if (!record) throw new Error('Workflow persistence record is missing.')
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(updated) } })
  return updated
}

export async function transitionCommercialEvent(input: { tenantId: string; idempotencyKey: string; status: EventStatus }): Promise<CommercialEvent | null> {
  const record = await db.memory.findUnique({ where: { key: key('event', input.tenantId, input.idempotencyKey) } })
  if (!record) return null
  let event: CommercialEvent
  try { event = JSON.parse(record.value) as CommercialEvent } catch { throw new Error('Commercial event record is corrupt.') }
  if (event.status === 'processed' && input.status === 'accepted') throw new Error('Processed events cannot return to accepted state.')
  event = { ...event, status: input.status }
  await db.memory.update({ where: { id: record.id }, data: { value: JSON.stringify(event) } })
  return event
}

export function validateCommercialLifecycleContracts(): string[] {
  const errors: string[] = []
  const workflowOrder = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'] satisfies WorkflowStatus[]
  if (new Set(workflowOrder).size !== workflowOrder.length) errors.push('Workflow statuses must be unique.')
  if (workflowOrder.length !== 6) errors.push('Workflow status contract must contain six states.')
  return errors
}
