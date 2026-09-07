import { mkdirSync, writeFileSync } from 'node:fs'
import { scoreCeoConversationRubric, type ConversationRubricScore } from '../src/lib/ceo-conversation-rubric'
import { CEO_CONVERSATION_RUBRIC_CORPUS, type RubricScenario } from '../tests/fixtures/ceo-conversation-rubric-corpus'

// Step 3 of the conversational re-architecture, shadow mode: runs the full rubric benchmark corpus
// and reports the result -- never gates a build. There is only one conversational pipeline now
// (Steps 1-2 already cut over directly rather than maintaining an old path in parallel), so this is
// not a live old-vs-candidate comparison; it is the broad, versioned regression signal that plan
// called for, wired into CI as observational only (see the workflow step's continue-on-error, and
// this script never calling process.exit with a nonzero code for a scenario-level regression).

interface ScenarioReport {
  name: string
  category: string
  composite: number
  expectMinComposite: number
  belowFloor: boolean
  dimensions: ConversationRubricScore
}

function run(): { report: ScenarioReport[]; summary: Record<string, unknown> } {
  const report: ScenarioReport[] = CEO_CONVERSATION_RUBRIC_CORPUS.map((scenario: RubricScenario) => {
    const dimensions = scoreCeoConversationRubric({
      objective: scenario.objective,
      content: scenario.content,
      intent: scenario.intent,
      responseAction: scenario.responseAction,
      priorTurns: scenario.priorTurns,
    })
    return {
      name: scenario.name,
      category: scenario.category,
      composite: dimensions.composite,
      expectMinComposite: scenario.expectMinComposite,
      belowFloor: dimensions.composite < scenario.expectMinComposite,
      dimensions,
    }
  })
  const composites = report.map((entry) => entry.composite)
  const byDimension: Record<string, number[]> = { meaning: [], context: [], reference: [], truth: [], reasoning: [], continuity: [], naturalness: [], progression: [] }
  for (const entry of report) for (const key of Object.keys(byDimension)) byDimension[key]!.push((entry.dimensions as any)[key])
  const average = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length))
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalScenarios: report.length,
    belowFloorCount: report.filter((entry) => entry.belowFloor).length,
    averageComposite: average(composites),
    minComposite: Math.min(...composites),
    averageByDimension: Object.fromEntries(Object.entries(byDimension).map(([key, values]) => [key, average(values)])),
    categoryCounts: Object.fromEntries([...new Set(report.map((entry) => entry.category))].map((category) => [category, report.filter((entry) => entry.category === category).length])),
  }
  return { report, summary }
}

function main() {
  const { report, summary } = run()
  console.log('[ceo-conversation-shadow-benchmark] summary:', JSON.stringify(summary, null, 2))
  const belowFloor = report.filter((entry) => entry.belowFloor)
  if (belowFloor.length) {
    console.warn(`[ceo-conversation-shadow-benchmark] ${belowFloor.length} scenario(s) fell below their calibrated floor (shadow mode: reported, not blocking):`)
    for (const entry of belowFloor) console.warn(`  - ${entry.name} [${entry.category}]: composite ${entry.composite} < floor ${entry.expectMinComposite}`)
  } else {
    console.log('[ceo-conversation-shadow-benchmark] all scenarios at or above their calibrated floor.')
  }
  mkdirSync('.artifacts', { recursive: true })
  writeFileSync('.artifacts/ceo-conversation-shadow-benchmark.json', JSON.stringify({ summary, report }, null, 2))
  console.log('[ceo-conversation-shadow-benchmark] report written to .artifacts/ceo-conversation-shadow-benchmark.json')
  // Shadow mode: this script is observational and must never fail a build on its own. The formal,
  // blocking regression gate is tests/ceo-conversation-rubric.test.ts (bun test), which asserts each
  // scenario's calibrated floor directly.
  process.exit(0)
}

main()
