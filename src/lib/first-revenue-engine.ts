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
const BASE_CURRENCY = 'CAD'
const ENGINE_SOURCE = 'first_revenue_engine'
const OPPORTUNITY_TITLE = 'AI-assisted business operations service for small businesses'
const SERVICE_NAME = 'AI Business Operations Starter'

function inferStage(input: {
  verifiedRevenue: number
  prospects: number
  opportunities: number
  services: number
}): RevenueStage {
  if (input.verifiedRevenue >= TARGET) return 'learning'
  if (input.prospects > 0) return 'sale'
  if (input.services > 0) return 'acquisition'
  if (input.opportunities > 0) return 'offer'
  return 'opportunity'
}

export async function getFirstRevenueMission(userId: string): Promise<RevenueMission> {
  const [transactions, prospects, opportunities, services] = await Promise.all([
    db.transaction.findMany({
      where: { userId, status: 'succeeded', currency: BASE_CURRENCY },
      select: { amount: true },
    }),
    db.customer.count({ where: { userId, source: ENGINE_SOURCE } }),
    db.opportunity.count({ where: { userId, source: ENGINE_SOURCE, status: { not: 'retired' } } }),
    db.servicePackage.count({ where: { userId, active: true, name: SERVICE_NAME } }),
  ])

  // Never add amounts across currencies. The first-revenue service is priced in CAD,
  // so only successful CAD transactions contribute to the mission's verified total.
  const verifiedRevenue = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0)
  const stage = inferStage({ verifiedRevenue, prospects, opportunities, services })

  const blockers: string[] = []
  let nextAction = ''

  switch (stage) {
    case 'opportunity':
      nextAction = 'Validate one reachable customer problem and create a single opportunity record.'
      blockers.push('No active first-revenue opportunity is recorded.')
      break
    case 'offer':
      nextAction = 'Turn the first-revenue opportunity into one specific, priced service package.'
      if (services === 0) blockers.push('The first-revenue service package is not active.')
      break
    case 'acquisition':
      nextAction = 'Add qualified prospects to the CRM and start direct conversations for the active offer.'
      blockers.push('No first-revenue prospect is recorded yet.')
      break
    case 'sale':
      nextAction = 'Convert a qualified prospect through the configured payment flow; do not manually count the sale as revenue.'
      blockers.push('A first-revenue prospect exists, but no processor-verified CAD transaction exists.')
      break
    case 'learning':
      nextAction = 'Review the first verified transaction, fulfillment outcome, acquisition source, and repeatability before scaling.'
      break
    default:
      nextAction = 'Complete the next revenue stage and record evidence.'
  }

  return {
    stage,
    goal: `First verified $1 of ${BASE_CURRENCY} revenue`,
    nextAction,
    blockers,
    verifiedRevenue,
    customerCount: prospects,
    opportunityCount: opportunities,
    serviceCount: services,
  }
}

export async function initializeFirstRevenueMission(userId: string) {
  // Scope initialization to records owned by this engine. Existing unrelated
  // opportunities/offers must never be silently adopted by the revenue mission.
  const opportunity = await db.opportunity.findFirst({
    where: { userId, source: ENGINE_SOURCE, title: OPPORTUNITY_TITLE, status: { not: 'retired' } },
    orderBy: { createdAt: 'desc' },
  }) ?? await db.opportunity.create({
    data: {
      userId,
      title: OPPORTUNITY_TITLE,
      description: 'Validate a narrowly scoped service that solves a measurable operational problem for a reachable small-business customer. Revenue is counted only after a verified payment transaction.',
      category: 'ai_business_service',
      source: ENGINE_SOURCE,
      status: 'new',
      riskScore: 3,
    },
  })

  const service = await db.servicePackage.findFirst({
    where: { userId, active: true, name: SERVICE_NAME },
    orderBy: { createdAt: 'desc' },
  }) ?? await db.servicePackage.create({
    data: {
      userId,
      name: SERVICE_NAME,
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
  const name = input.name.trim()
  if (!name) throw new Error('Prospect name is required')

  return db.customer.create({
    data: {
      userId,
      name,
      email: input.email?.trim() || null,
      company: input.company?.trim() || null,
      source: ENGINE_SOURCE,
      notes: input.notes?.trim() || null,
      status: 'lead',
      value: 0,
    },
  })
}
