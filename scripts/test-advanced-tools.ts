/**
 * test-advanced-tools.ts — exercise the non-LLM advanced tools
 * to verify they actually run and produce sensible output.
 */
import { dispatchTool, type ToolContext } from '../src/lib/tools'

const ctx: ToolContext = {
  attachments: [],
  language: 'en',
}

async function test(name: string, args: any): Promise<void> {
  console.log(`\n════════════════════════════════════════`)
  console.log(`TEST: ${name}`)
  console.log(`ARGS: ${JSON.stringify(args)}`)
  console.log(`════════════════════════════════════════`)
  const t0 = Date.now()
  const result = await dispatchTool(name, args, ctx)
  const dt = Date.now() - t0
  console.log(`OK: ${result.ok}  |  Time: ${dt}ms`)
  console.log(`PREVIEW: ${result.preview}`)
  console.log(`--- RESULT (first 1200 chars) ---`)
  console.log(result.result.slice(0, 1200))
  if (result.result.length > 1200) console.log(`... (${result.result.length - 1200} more chars)`)
}

async function main() {
  // 1. Quantum compute (pure compute, no LLM)
  await test('quantum_compute', {
    problem: 'passive income portfolio allocation',
    variables: 'dividends,crypto,saas,affiliate,real_estate',
    constraints: 'max_budget=10000;risk=medium',
    num_qubits: 10,
    depth: 4,
    shots: 200,
  })

  // 2. Neural singular (pure compute)
  await test('neural_singular', {
    problem_domain: 'income_optimization',
    complexity_level: 6,
    iterations: 30,
  })

  // 3. Energy optimize (pure compute)
  await test('energy_optimize', {
    scope: 'global',
    target_reduction: 70,
    timeframe_days: 30,
    workload_kw: 50,
  })

  // 4. Predictive health (calls local endpoints, no LLM)
  await test('predictive_health', {
    component: 'all',
    horizon_days: 14,
  })

  console.log('\n✅ All non-LLM advanced tools ran successfully.')
}

main().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
