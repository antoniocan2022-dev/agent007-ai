import { readFile } from 'node:fs/promises'

const requiredFiles = [
  'prisma/schema.prisma',
  'scripts/db-reconcile.ts',
  'src/app/api/webhooks/stripe/route.ts',
  'src/lib/business-outcome-integrity.ts',
  'src/lib/operational-kpi-engine.ts',
  'src/lib/ceo-venture-state.ts',
  'src/lib/portfolio-decision-contract.ts',
  'src/lib/portfolio-intelligence-rules.ts',
  'src/lib/venture-scorecard.ts',
  'src/lib/venture-decision-engine.ts',
  'src/lib/portfolio-experiments.ts',
  'src/lib/portfolio-experiment-attribution.ts',
  'src/lib/portfolio-intelligence-engine.ts',
]

const files = new Map<string, string>()
for (const path of requiredFiles) files.set(path, await readFile(path, 'utf8'))

const schema = files.get('prisma/schema.prisma')!
const reconcile = files.get('scripts/db-reconcile.ts')!
const webhook = files.get('src/app/api/webhooks/stripe/route.ts')!
const outcome = files.get('src/lib/business-outcome-integrity.ts')!
const kpi = files.get('src/lib/operational-kpi-engine.ts')!
const ceo = files.get('src/lib/ceo-venture-state.ts')!
const contract = files.get('src/lib/portfolio-decision-contract.ts')!
const rules = files.get('src/lib/portfolio-intelligence-rules.ts')!
const scorecard = files.get('src/lib/venture-scorecard.ts')!
const decision = files.get('src/lib/venture-decision-engine.ts')!
const experiments = files.get('src/lib/portfolio-experiments.ts')!
const attribution = files.get('src/lib/portfolio-experiment-attribution.ts')!
const intelligence = files.get('src/lib/portfolio-intelligence-engine.ts')!

const checks: Array<[string, boolean]> = [
  ['Transaction has customerId + Customer relation + index', /model Transaction[\s\S]*?customerId\s+String\?[\s\S]*?@relation\(fields:\s*\[customerId\][\s\S]*?references:\s*\[id\][\s\S]*?@@index\(\[customerId\]\)/.test(schema)],
  ['Reconciliation self-checks customerId schema integrity', reconcile.includes('customerId') && reconcile.includes('FOREIGN KEY')],
  ['Stripe webhook verifies provider signature', webhook.includes('constructEvent')],
  ['Stripe webhook persists canonical venture scope', webhook.includes('ventureId') && webhook.includes('db.transaction.create')],
  ['Stripe webhook emits verified BusinessOutcome', webhook.includes('recordVerifiedTransactionOutcome')],
  ['BusinessOutcome verifies Transaction before revenue proof', outcome.includes('assertRealSucceededTransaction')],
  ['Experiment attribution is awaited without a swallowed error path', outcome.includes('await recordExperimentPaymentAttribution(') && !/recordExperimentPaymentAttribution\([\s\S]*?\)\.catch\(/.test(outcome)],
  ['KPI engine independently verifies transaction evidence', kpi.includes('assertRealSucceededTransaction')],
  ['CEO reads canonical decision engine', ceo.includes('evaluateVentureDecision') && ceo.includes('CANONICAL_DECISION')],
  ['Canonical portfolio decision contract exists', contract.includes('PortfolioOperationalDecision') && contract.includes('VentureLifecycleDecision')],
  ['Portfolio rules consume the canonical operational decision taxonomy', rules.includes('PortfolioDecision')],
  ['Venture scorecard consumes the canonical health decision taxonomy', scorecard.includes('VentureHealthDecision')],
  ['Venture decision engine consumes canonical lifecycle decision type', decision.includes("from './portfolio-decision-contract'") && decision.includes('VentureLifecycleDecision')],
  ['Decision=experiment activates a real experiment', intelligence.includes('activatePortfolioExperiment') && intelligence.includes("decision.decision === 'experiment'")) ,
  ['Experiment state machine persists proposed/approved/running/completed', experiments.includes("proposed: ['approved', 'rejected']") && experiments.includes('completePortfolioExperiment')],
  ['Payment attribution verifies a succeeded transaction', attribution.includes('assertRealSucceededTransaction')],
  ['Attribution is scoped to experiment business', attribution.includes('experiment.business !== input.business')],
]

const failures = checks.filter(([, ok]) => !ok).map(([name]) => name)
if (failures.length) throw new Error(`P0/P1 autonomy audit failed: ${failures.join('; ')}`)
console.log(JSON.stringify({ ok: true, checks: checks.length, failures: [] }, null, 2))
