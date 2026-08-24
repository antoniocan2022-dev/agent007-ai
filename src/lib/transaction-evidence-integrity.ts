import { db } from './db'

export interface TransactionEvidenceInput {
  ventureId: string
  transactionId: string
  customerId?: string
  amount?: number
  currency?: string
}

export interface VerifiedTransactionEvidence {
  id: string
  ventureId: string
  customerId: string | null
  amount: number
  currency: string
  status: string
  createdAt: string
}

function normalizeOptionalId(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

export function validateTransactionEvidence(input: TransactionEvidenceInput): string[] {
  const errors: string[] = []
  if (!input.ventureId.trim()) errors.push('ventureId is required.')
  if (!input.transactionId.trim()) errors.push('transactionId is required.')
  const customerId = normalizeOptionalId(input.customerId)
  if (input.customerId != null && !customerId) errors.push('customerId must not be blank when supplied.')
  if (input.amount != null && (!Number.isFinite(input.amount) || input.amount <= 0)) errors.push('amount must be positive and finite when supplied.')
  if (input.currency != null && !/^[A-Z]{3}$/i.test(input.currency.trim())) errors.push('currency must be an ISO-4217 alpha-3 code when supplied.')
  return errors
}

export async function assertRealSucceededTransaction(input: TransactionEvidenceInput): Promise<VerifiedTransactionEvidence> {
  const errors = validateTransactionEvidence(input)
  if (errors.length) throw new Error(`Transaction evidence validation failed: ${errors.join(' | ')}`)

  const transaction = await db.transaction.findUnique({
    where: { id: input.transactionId.trim() },
    select: {
      id: true,
      userId: true,
      ventureId: true,
      customerId: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  })

  if (!transaction) throw new Error(`Transaction not found: ${input.transactionId}.`)
  if (transaction.ventureId !== input.ventureId.trim()) throw new Error(`Transaction ${transaction.id} is not scoped to venture ${input.ventureId}.`)

  const expectedCustomerId = normalizeOptionalId(input.customerId)
  if (expectedCustomerId && transaction.customerId !== expectedCustomerId) {
    throw new Error(`Transaction ${transaction.id} customer does not match supplied evidence.`)
  }

  if (transaction.customerId) {
    const customer = await db.customer.findUnique({
      where: { id: transaction.customerId },
      select: { id: true, userId: true },
    })
    if (!customer) throw new Error(`Transaction ${transaction.id} references a customer that is not present.`)
    if (customer.userId !== transaction.userId) throw new Error(`Transaction ${transaction.id} references a customer owned by a different user.`)
  }

  if (transaction.status !== 'succeeded') throw new Error(`Transaction ${transaction.id} is not succeeded.`)
  if (!Number.isFinite(Number(transaction.amount)) || Number(transaction.amount) <= 0) throw new Error(`Transaction ${transaction.id} has no positive amount.`)
  if (!/^[A-Z]{3}$/i.test(transaction.currency)) throw new Error(`Transaction ${transaction.id} has an invalid currency code.`)
  if (input.amount != null && Number(transaction.amount) !== Number(input.amount)) throw new Error(`Transaction ${transaction.id} amount does not match supplied evidence.`)
  if (input.currency != null && transaction.currency.toUpperCase() !== input.currency.trim().toUpperCase()) throw new Error(`Transaction ${transaction.id} currency does not match supplied evidence.`)

  return {
    id: transaction.id,
    ventureId: transaction.ventureId,
    customerId: transaction.customerId,
    amount: Number(transaction.amount),
    currency: transaction.currency.toUpperCase(),
    status: transaction.status,
    createdAt: transaction.createdAt.toISOString(),
  }
}
