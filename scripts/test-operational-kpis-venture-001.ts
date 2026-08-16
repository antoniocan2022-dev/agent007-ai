import { calculateBusinessHealth, calculateOperationalKpis, isOpenCrmStatus, isRealTransaction } from '../src/lib/operational-kpis'
import { validateVenture001Definition, VENTURE_001_REFERENCE } from '../src/lib/venture-001'
import type { Business } from '../src/lib/business-portfolio'

const assert = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message) }
const now = new Date('2026-08-16T16:00:00.000Z')
const business = (overrides: Partial<Business> = {}): Business => ({
  businessId: 'biz-test', name: 'Test Venture', type: 'saas', description: 'Test', lifecycle: 'active',
  createdAt: now.toISOString(), launchedAt: now.toISOString(), retiredAt: null,
  monthlyRevenue: 1000, totalRevenue: 3000, monthlyCost: 200, netRevenue: 800, roi: 400,
  customerCount: 7, emailListSize: 0, automationLevel: 80, knowledgeAssets: 2, brandScore: 70,
  targetMarket: 'Test', pricingModel: 'subscription', automationNotes: '', retirementReason: null,
  ...overrides,
})

assert(validateVenture001Definition().length === 0, 'Venture 001 definition contract is invalid.')
assert(VENTURE_001_REFERENCE.name === 'AI Book Business', 'Venture 001 identity drifted.')
assert(isRealTransaction({ amount: 1000, status: 'succeeded', providerTxId: 'txn_123' }), 'Succeeded transaction should count as real revenue.')
assert(isRealTransaction({ amount: 250, status: 'settled', providerTxId: 'order_456' }), 'Settled transaction should count as real revenue.')
assert(!isRealTransaction({ amount: 500, status: 'succeeded', providerTxId: '' }), 'Transaction without provider identity must not count.')
assert(!isRealTransaction({ amount: 500, status: 'pending', providerTxId: 'txn_pending' }), 'Pending transaction must not count as realized revenue.')
assert(isOpenCrmStatus('lead'), 'Lead must count as an open CRM opportunity.')
assert(!isOpenCrmStatus('customer'), 'Customer must not count as an open CRM opportunity.')

const snapshot = calculateOperationalKpis({
  now,
  missions: [{ status: 'running' }, { status: 'completed' }, { status: 'failed' }, { status: 'completed' }],
  businesses: [business(), business({ businessId: 'biz-ref', name: VENTURE_001_REFERENCE.name, lifecycle: 'proposed', monthlyRevenue: 0, customerCount: 0, automationLevel: 0, brandScore: 0, roi: 0 })],
  transactions: [
    { amount: 1000, provider: 'stripe', providerTxId: 'txn_123', status: 'succeeded', createdAt: new Date('2026-08-10T00:00:00.000Z') },
    { amount: 250, provider: 'paypal', providerTxId: 'order_456', status: 'settled', createdAt: new Date('2026-08-01T00:00:00.000Z') },
    { amount: 500, provider: 'stripe', providerTxId: 'txn_pending', status: 'pending', createdAt: new Date('2026-08-05T00:00:00.000Z') },
    { amount: 300, provider: 'stripe', providerTxId: 'txn_old', status: 'succeeded', createdAt: new Date('2026-07-01T00:00:00.000Z') },
  ],
  customerCount: 12,
  openOpportunities: 5,
})

assert(snapshot.missions.total === 4, 'Mission total calculation failed.')
assert(snapshot.missions.active === 1, 'Active mission calculation failed.')
assert(snapshot.missions.completed === 2 && snapshot.missions.failed === 1, 'Mission terminal counts failed.')
assert(snapshot.missions.successRate === 66.7, 'Mission success rate calculation failed.')
assert(snapshot.ventures.active === 1, 'Reference venture leaked into active portfolio count.')
assert(snapshot.ventures.portfolioMrr === 1000, 'Reference venture leaked into portfolio MRR.')
assert(snapshot.ventures.customers === 7, 'Reference venture leaked into portfolio customer count.')
assert(snapshot.commercial.revenue30d === 1250, '30-day realized revenue calculation failed.')
assert(snapshot.commercial.transactions30d === 2, '30-day realized transaction count failed.')
assert(snapshot.commercial.customers === 12, 'Commercial customer count calculation failed.')
assert(snapshot.commercial.openOpportunities === 5, 'Open CRM opportunity calculation failed.')
assert(snapshot.referenceVenture001.exists, 'Venture 001 reference detection failed.')
assert(snapshot.referenceVenture001.lifecycle === 'proposed', 'Venture 001 must initialize as proposed.')
assert(snapshot.referenceVenture001.monthlyRevenue === 0, 'Venture 001 must not seed revenue.')
assert(snapshot.referenceVenture001.ventureScore === null, 'Venture 001 score must remain evidence-driven.')
assert(calculateBusinessHealth(business()) === 86, 'Deterministic business health calculation failed.')

console.log('Operational KPI + Venture 001 focused tests: PASS')
