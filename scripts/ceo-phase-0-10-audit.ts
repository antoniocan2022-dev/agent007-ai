import { readFileSync, existsSync } from 'node:fs'
import { CEO_SYSTEM_CONTRACT, assertCeoSystemContract } from '../src/lib/ceo-system-contract'
import { CEO_PERSONALITY_CHARTER } from '../src/lib/ceo-personality'
import { CEO_CAPABILITY_ARCHITECTURE, findCapability } from '../src/lib/ceo-capability-architecture'

const failures: string[] = []
const required = [
  'src/lib/ceo-system-contract.ts',
  'src/lib/ceo-personality.ts',
  'src/lib/ceo-curiosity.ts',
  'src/lib/ceo-capability-architecture.ts',
  'src/lib/ceo-tool-selection.ts',
  'src/lib/ceo-evidence-bundle.ts',
  'src/lib/ceo-world-model.ts',
  'src/lib/ceo-operator-intelligence.ts',
]
for (const file of required) if (!existsSync(file)) failures.push(`Missing canonical phase module: ${file}`)
if (assertCeoSystemContract() !== true) failures.push('Phase 0 system contract assertion failed')
for (const dimension of ['Business Partner', 'Friend', 'Psychological Insight', 'Technologist', 'Great Thinker', 'Operator', 'Guardian', 'CEO Curiosity']) if (!CEO_PERSONALITY_CHARTER.includes(dimension)) failures.push(`Unified personality missing dimension: ${dimension}`)
if (CEO_SYSTEM_CONTRACT.capabilityAbstraction !== 'capability_before_tool') failures.push('Phase 6 capability abstraction is not authoritative')
if (CEO_SYSTEM_CONTRACT.worldModel !== 'single_world_with_facets') failures.push('Phase 9 must use one world model')
if (CEO_SYSTEM_CONTRACT.executionTruth !== 'execution_requires_observable_completion_and_verification') failures.push('Phase 10 execution truth contract is invalid')
if (CEO_CAPABILITY_ARCHITECTURE.length < 10) failures.push('Capability architecture is missing major enterprise domains')
if (!findCapability('research.general')) failures.push('Research capability missing')
if (!findCapability('market.competitive')) failures.push('Market intelligence capability missing')
const preRouter = readFileSync('src/lib/ceo-pre-router.ts', 'utf8')
const lifecycle = readFileSync('src/lib/ceo-cognitive-lifecycle.ts', 'utf8')
if (!preRouter.includes("from './ceo-curiosity'")) failures.push('Pre-router does not include canonical curiosity gate')
if (!preRouter.includes('semanticContext?: CanonicalConversationContext')) failures.push('Pre-router does not accept canonical semantic context')
if (!lifecycle.includes('decisionContract?.responseAction')) failures.push('Lifecycle does not consume canonical response action')
if (lifecycle.includes('Evidence state: UNAVAILABLE')) failures.push('Lifecycle contains user-facing internal evidence-state language')
if (failures.length) { console.error('CEO phase 0-10 audit FAILED'); for (const failure of failures) console.error(`- ${failure}`); process.exit(1) }
console.log(`CEO phase 0-10 audit PASSED: ${required.length} canonical phase modules, unified personality, capability hierarchy, curiosity, evidence, world model and operator invariants verified.`)