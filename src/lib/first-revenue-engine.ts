import { db } from '@/lib/db'

export type RevenueStage =
  | 'opportunity'
  | 'offer'
  | 'acquisition'
  | 'sale'
  | 'fulfillment'
  | 'verified_revenue'
  | 'learning'

export type RevenueMission = {
  stage: RevenueStage
  goal: string
  nextAction: string
  blockers: string[]
  verifiedRevenue: number
  customerCount: number
  opportunityCount: number
  serviceCount: number
}

const TARGET = 1

function inferStage(input: {
  verifiedRevenue: number
  customers: number
  opportunities: number
  services: number
}): RevenueStage {
  if (input.verifiedRevenue >= TARGET) return 'learning'
  if (input.customers > 0) return 'sale'
  if (input.services > 0) return 'acquisition'
  if (input.opportunities > 0) return 'offer'
  return 'opportunity'
}

export async function getFirstRevenueMission(userId: string): Promise<RevenueMission> {
  const [transactions, customers, opportunities, services] = await Promise.all([
    db.transaction.findMany({ where: { userId, status: 'succeeded' }, select: { amount: true, currency: true } }),
    db.customer.count({ where: { userId } }),
    db.opportunity.count({ where: { userId, status: { not: 'retired' } } }),
    db.servicePackage.count({ where: { userId, active: true } }),
  ])

  const verifiedRevenue = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  const stage = inferStage({ verifiedRevenue, customers, opportunities, services })

  const blockers: string[] = []
  let nextAction = ''

  switch (stage) {
    case 'opportunity':
      nextAction = 'Validate one reachable customer problem and create a single opportunity record.'
      blockers.push('No active revenue opportunity is recorded.')
      break
    case 'offer':
      nextAction = 'Turn the strongest opportunity into one specific, priced service package.'
      if (services === 0) blockers.push('No active service package is recorded.')
      break
    case 'acquisition':
      nextAction = 'Add qualified prospects to the CRM and start direct conversations for the active offer.'
      blockers.push('No verified customer transaction exists yet.')
      break
    case 'sale':
      nextAction = 'Convert a qualified prospect through the configured payment flow; do not manually count the sale as revenue.'
      blockers.push('A CRM customer exists, but no processor-verified transaction exists.')
      break
    case 'learning':
      nextAction = 'Review the first verified transaction, fulfillment outcome, acquisition source, and repeatability before scaling.'
      break
    default:
      nextAction = 'Complete the next revenue stage and record evidence.'
  }

  return {
    stage,
    goal: 'First verified $1 of revenue',
    nextAction,
    blockers,
    verifiedRevenue,
    customerCount: customers,
    opportunityCount: opportunities,
    serviceCount: services,
  }
}

export async function initializeFirstRevenueMission(userId: string) {
  const existing = await db.opportunity.findFirst({
    where: { userId, status: { not: 'retired' } },
    orderBy: { createdAt: 'desc' },
  })

  const opportunity = existing ?? await db.opportunity.create({
    data: {
      userId,
      title: 'AI-assisted business operations service for small businesses',
      description: 'Validate a narrowly scoped service that solves a measurable operational problem for a reachable small-business customer. Revenue is counted only after a verified payment transaction.',
      category: 'ai_business_service',
      source: 'first_revenue_engine',
      status: 'new',
      riskScore: 3,
    },
  })

  const existingPackage = await db.servicePackage.findFirst({
    where: { userId, active: true },
    orderBy: { createdAt: 'desc' },
  })

  const service = existingPackage ?? await db.servicePackage.create({
    data: {
      userId,
      name: 'AI Business Operations Starter',
      description: 'A tightly scoped, outcome-based AI operations service. Final scope and price must be validated with the first prospect before scaling.',
      category: 'consulting',
      priceOneTime: 250,
      priceMonthly: 0,
      deliveryTime: '3-5 business days',
      features: JSON.stringify(['Business workflow review', 'One prioritized automation opportunity', 'Implementation plan', 'Handoff documentation']),
      active: true,
    },
  })

  const strategy = await db.businessStrategy.findFirst({
    where: { userId, title: 'First Verified Revenue' },
  })

  if (!strategy) {
    await db.businessStrategy.create({
      data: {
        userId,
        phase: 'phase1_validation',
        title: 'First Verified Revenue',
        description: 'Reach the first real customer payment using one validated offer. Never treat projections, quoted prices, or agent text as revenue.',
        status: 'active',
        priority: 'critical',
        progress: 0,
      },
    })
  }

  return { opportunity, service, mission: await getFirstRevenueMission(userId) }
}

export async function addProspect(userId: string, input: { name: string; email?: string; company?: string; source?: string; notes?: string }) {
  if (!input.name.trim()) throw new Error('Prospect name is required')

  return db.customer.create({
    data: {
      userId,
      name: input.name.trim(),
      email: input.email?.trim() || null,
      company: input.company?.trim() || null,
      source: input.source?.trim() || 'first_revenue_engine',
      notes: input.notes?.trim() || null,
      status: 'lead',
      value: 0,
    },
  })
}
