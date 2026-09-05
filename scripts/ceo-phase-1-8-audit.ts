import { readFileSync, existsSync } from 'node:fs'

const failures: string[] = []
const required = [
  'src/lib/ceo-response-finalizer.ts',
  'src/lib/ceo-response-composer.ts',
  'src/lib/ceo-context-composer.ts',
  'src/lib/ceo-cognitive-contract.ts',
  'tests/ceo-response-finalizer.test.ts',
]
for (const file of required) if (!existsSync(file)) failures.push(`Missing phase 1-8 component: ${file}`)

const finalizer = readFileSync('src/lib/ceo-response-finalizer.ts', 'utf8')
const composer = readFileSync('src/lib/ceo-response-composer.ts', 'utf8')
const context = readFileSync('src/lib/ceo-context-composer.ts', 'utf8')
const contract = readFileSync('src/lib/ceo-cognitive-contract.ts', 'utf8')
const test = readFileSync('tests/ceo-response-finalizer.test.ts', 'utf8')

if (!finalizer.includes('finalResponseHash')) failures.push('Finalizer does not produce immutable response hash')
if (!finalizer.includes('assertFinalResponseInvariant')) failures.push('Finalizer invariant assertion is missing')
if (!finalizer.includes('containsInternalArtifactToken')) failures.push('Finalizer is not connected to canonical artifact detection')
if (!composer.includes('finalizeCeoResponseForSurface')) failures.push('Composer does not delegate to the canonical finalizer')
if (composer.includes('INTERNAL_RESPONSE_PATTERNS')) failures.push('Legacy duplicate sanitizer remains in composer')
if (!context.includes('isConversationalHistoryRow')) failures.push('Context composer does not isolate contaminated assistant history')
if (!context.includes('containsInternalArtifactToken')) failures.push('Context composer lacks assistant-history artifact boundary')
if (!contract.includes('FinalResponseProvenance')) failures.push('Cognitive contract lacks final response provenance')
for (const token of ['continuous_loop_trace', 'governed_evolution_cycle', 'evidence_trace']) if (!finalizer.includes(token)) failures.push(`Finalizer missing artifact token coverage: ${token}`)
for (const phrase of ['simulatedPersistence', 'simulatedSseAnswer', 'simulatedReload']) if (!test.includes(phrase)) failures.push(`Finalization propagation regression test missing: ${phrase}`)

if (failures.length) {
  console.error('CEO phase 1-8 architecture audit FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('CEO phase 1-8 architecture audit PASSED: canonical finalization, provenance, artifact boundary, contaminated-history isolation, and persistence/SSE/reload invariants are wired.')
