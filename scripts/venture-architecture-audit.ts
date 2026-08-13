import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CEO_VENTURE_MANDATE } from '../src/lib/venture-mandate'
import { VENTURE_SCORE_CATEGORIES, VENTURE_SCORE_THRESHOLD, VID_WORKFLOW_STAGES } from '../src/lib/vid-data'
import { OPPORTUNITY_WEIGHTS, HEALTH_WEIGHTS, VENTURE_SCORECARD_VERSION } from '../src/lib/venture-scorecard'
import { VENTURE_DECISION_ENGINE_VERSION } from '../src/lib/venture-decision-engine'
import { VENTURE_OS_ID, VENTURE_OS_VERSION, validateVentureOSContracts } from '../src/lib/venture-os'

const root = process.cwd()
const errors: string[] = []
const warnings: string[] = []

function fail(message: string) { errors.push(message) }
function read(path: string): string {
  try { return readFileSync(join(root, path), 'utf8') } catch { return '' }
}

const requiredFiles = [
  'src/lib/venture-os.ts',
  'src/lib/venture-os.test.ts',
  'src/lib/venture-mandate.ts',
  'src/lib/venture-scorecard.ts',
  'src/lib/venture-decision-engine.ts',
  'src/lib/venture-decision-engine.test.ts',
  'src/app/api/system/venture-os/route.ts',
  'src/app/api/system/venture-decision/route.ts',
  'scripts/venture-architecture-audit.ts',
]
for (const file of requiredFiles) if (!existsSync(join(root, file))) fail(`Missing canonical Venture file: ${file}`)

const forbiddenSuffixes = ['.bak', '.old', '.orig', '.copy']
const suspicious: string[] = []
function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (['.git', 'node_modules', '.next'].includes(entry)) continue
    const absolute = join(dir, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) walk(absolute)
    else if (forbiddenSuffixes.some((suffix) => entry.endsWith(suffix)) || /\s+copy\./i.test(entry) || /-copy\./i.test(entry)) suspicious.push(relative(root, absolute))
  }
}
walk(root)
for (const file of suspicious) fail(`Suspicious duplicate/backup artifact present: ${file}`)

const allSource = ['src', 'scripts'].filter((dir) => existsSync(join(root, dir))).flatMap((dir) => {
  const files: string[] = []
  function collect(path: string) {
    for (const entry of readdirSync(path)) {
      if (['node_modules', '.next'].includes(entry)) continue
      const absolute = join(path, entry)
      if (statSync(absolute).isDirectory()) collect(absolute)
      else if (/\.(ts|tsx|js|jsx|md|json)$/.test(entry)) files.push(absolute)
    }
  }
  collect(join(root, dir))
  return files
}).map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }))

const legacyFakeTools = [
  'organizational_knowledge_base', 'business_blueprint', 'ltv_cac_calculator',
  'portfolio_health_check', 'pricing_scenario_sim', 'business_flywheel',
  'market_validation_score', 'experiments_api', 'a_b_test_runner',
  'feedback_loop', 'adaptive_weights', 'predicted_iq', 'leader_debate',
  'closed_loop_improvement',
]
for (const token of legacyFakeTools) {
  if (allSource.some(({ text }) => text.includes(token))) warnings.push(`Legacy token still present somewhere in source: ${token}`)
}

const staleMissionTokens = ['generate passive income', '0K/month passive income', '$0K/month']
for (const token of staleMissionTokens) {
  const hits = allSource.filter(({ text }) => text.toLowerCase().includes(token.toLowerCase())).map(({ path }) => path)
  if (hits.length) warnings.push(`Stale mission phrase '${token}' found in: ${hits.join(', ')}`)
}

const prismaFiles = allSource.filter(({ path }) => path.endsWith('prisma/schema.prisma') || /schema\.prisma\.(bak|old|orig|copy)$/.test(path))
if (prismaFiles.filter(({ path }) => path === 'prisma/schema.prisma').length !== 1) fail('Canonical prisma/schema.prisma is missing or duplicated.')
if (prismaFiles.some(({ path }) => path !== 'prisma/schema.prisma')) fail('Prisma schema backup/duplicate file detected.')

const vercel = read('vercel.json')
if (!vercel.includes('"deploymentEnabled"') || !vercel.includes('false')) fail('Vercel automatic Git deployment guard is not explicitly disabled in vercel.json.')

const portfolioRoute = read('src/app/api/system/portfolio/route.ts')
const flywheelRoute = read('src/app/api/system/flywheel/route.ts')
const healthRoute = read('src/app/api/system/portfolio-health/route.ts')
const crossInsightsRoute = read('src/app/api/system/cross-insights/route.ts')
for (const [name, text] of [['portfolio', portfolioRoute], ['flywheel', flywheelRoute], ['portfolio-health', healthRoute], ['cross-insights', crossInsightsRoute]] as const) {
  if (!text.includes('getServerSession') || !text.includes('authOptions')) fail(`${name} route lacks explicit route-level authentication.`)
}
if (flywheelRoute.includes('GET /api/system/flywheel → run full flywheel cycle')) fail('Flywheel route still documents GET as an unconditional mutating execution.')

if (VENTURE_OS_ID !== 'venture-os') fail(`Unexpected Venture OS id: ${VENTURE_OS_ID}`)
if (VENTURE_OS_VERSION < 3) fail(`Unexpected Venture OS version: ${VENTURE_OS_VERSION}`)
if (VENTURE_SCORECARD_VERSION < 3) fail(`Unexpected Venture Scorecard version: ${VENTURE_SCORECARD_VERSION}`)
if (VENTURE_DECISION_ENGINE_VERSION < 4) fail(`Unexpected Decision Engine version: ${VENTURE_DECISION_ENGINE_VERSION}`)
if (VENTURE_SCORE_THRESHOLD !== CEO_VENTURE_MANDATE.opportunityScoreMinimum) fail('CEO opportunity threshold drifts from VID Venture Score threshold.')
if (VENTURE_SCORE_CATEGORIES.reduce((sum, category) => sum + category.weight, 0) !== 100) fail('VID Venture Score weights do not total 100.')
if (Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0) !== 100) fail('Opportunity Scorecard weights do not total 100.')
if (Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0) !== 100) fail('Health Scorecard weights do not total 100.')
if (Object.keys(OPPORTUNITY_WEIGHTS).length !== VENTURE_SCORE_CATEGORIES.length) fail('Opportunity Scorecard dimension count drifts from VID Venture Score.')
if (OPPORTUNITY_WEIGHTS.marketDemand !== 20 || OPPORTUNITY_WEIGHTS.competition !== 10 || OPPORTUNITY_WEIGHTS.automationPotential !== 15 || OPPORTUNITY_WEIGHTS.timeToRevenue !== 15 || OPPORTUNITY_WEIGHTS.scalability !== 15 || OPPORTUNITY_WEIGHTS.recurringRevenue !== 15 || OPPORTUNITY_WEIGHTS.aiAdvantage !== 10) fail('Opportunity Scorecard weights drifted from the canonical VID values.')
if (VID_WORKFLOW_STAGES.length !== 13) fail(`VID workflow expected 13 stages, found ${VID_WORKFLOW_STAGES.length}.`)
if (new Set(VID_WORKFLOW_STAGES.map((stage) => stage.name.trim().toLowerCase())).size !== VID_WORKFLOW_STAGES.length) fail('VID workflow contains duplicate stage names.')
const contractErrors = validateVentureOSContracts().filter((issue) => issue.severity === 'error')
for (const issue of contractErrors) fail(`Venture OS contract error: ${issue.code} — ${issue.message}`)

if (warnings.length) console.warn('\nVenture architecture audit warnings:\n' + warnings.map((item) => `- ${item}`).join('\n'))
if (errors.length) {
  console.error('\nVenture architecture audit FAILED:\n' + errors.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.log(`Venture architecture audit PASSED: ${allSource.length} source files inspected, ${warnings.length} warning(s), 0 blocking errors.`)
