import type { PortfolioBusiness } from './portfolio-intelligence-contract'

export interface ExistingStripeTransaction {
  id: string
  userId: string
  status: string
  amount: number
  currency: string
  customerId: string | null
  ventureId: string | null
}

export interface IncomingStripeTransaction {
  userId: string
  status: 'succeeded'
  amount: number
  currency: string
  customerId: string | null
  ventureId: string | null
  experimentBusiness?: PortfolioBusiness
}

export function assertStripeReplayCompatible(
  existing: ExistingStripeTransaction,
  incoming: IncomingStripeTransaction,
): void {
  if (existing.userId !== incoming.userId) throw new Error(`Stripe replay owner mismatch for transaction ${existing.id}.`)
  if (Number(existing.amount) !== Number(incoming.amount)) throw new Error(`Stripe replay amount mismatch for transaction ${existing.id}.`)
  if (existing.currency.toUpperCase() !== incoming.currency.toUpperCase()) throw new Error(`Stripe replay currency mismatch for transaction ${existing.id}.`)
  if (existing.customerId && incoming.customerId && existing.customerId !== incoming.customerId) {
    throw new Error(`Stripe replay customer mismatch for transaction ${existing.id}.`)
  }
  if (existing.ventureId && incoming.ventureId && existing.ventureId !== incoming.ventureId) {
    throw new Error(`Stripe replay venture mismatch for transaction ${existing.id}.`)
  }
}

export function nextStripeTransactionState(existingStatus: string, incomingStatus: 'succeeded'): 'succeeded' | 'refunded' {
  // A late/replayed success event can never undo an already verified refund.
  if (existingStatus === 'refunded') return 'refunded'
  return incomingStatus
}
