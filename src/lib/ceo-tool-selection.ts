import type { CeoExecutionContract } from './ceo-cognitive-contract'
import { capabilityNeedFromDecision, findCapability, type ToolDescriptor } from './ceo-capability-architecture'
import { getToolOutcomeSnapshot } from './ceo-tool-outcome-intelligence'

export interface ToolScore { relevance: number; reliability: number; freshness: number; latency: number; cost: number; permissions: number; risk: number; verification: number; total: number }
export interface ToolSelection { capability: string; candidates: ToolDescriptor[]; selected?: ToolDescriptor; scores: Record<string, ToolScore>; executionStrategy: string; evidenceRequirements: string[] }

function scoreTool(tool: ToolDescriptor, need: { operation: string; requiresFreshness: boolean; capability: string }): ToolScore {
  const relevance = need.operation === 'research' && tool.id === 'web_search' ? 1 : need.operation === 'verify' && tool.id === 'page_reader' ? 0.95 : 0.7
  const latency = Math.max(0, 1 - tool.latencyMs / 30000)
  const permissions = tool.permissions.length ? 0.9 : 1
  const observedOutcome = getToolOutcomeSnapshot(tool.id, need.capability)
  const observedReliability = Math.max(0, Math.min(1, tool.reliability + observedOutcome.reliabilityAdjustment))
  const verification = need.operation === 'verify' ? Math.min(1, observedReliability + 0.05) : observedReliability
  const freshness = need.requiresFreshness ? tool.freshness : 0.8
  const total = 0.23 * relevance + 0.18 * observedReliability + 0.14 * freshness + 0.08 * latency + 0.08 * (1 - Math.min(1, tool.cost / 100)) + 0.09 * permissions + 0.10 * (1 - tool.risk) + 0.10 * verification
  return { relevance, reliability: observedReliability, freshness, latency, cost: tool.cost, permissions, risk: tool.risk, verification, total: Number(total.toFixed(4)) }
}

export function selectCeoTool(contract: CeoExecutionContract, options?: { requiresFreshness?: boolean }): ToolSelection {
  const need = capabilityNeedFromDecision(contract)
  const capabilityId = findCapability(`${need.domain === 'market_intelligence' ? 'market' : need.domain}.competitive`)?.id
    ?? findCapability(`${need.domain === 'research' ? 'research' : need.domain}.general` )?.id
  const descriptor = capabilityId ? findCapability(capabilityId) : undefined
  const candidates = descriptor?.services.flatMap((service) => service.tools) ?? []
  const scores: Record<string, ToolScore> = {}
  for (const candidate of candidates) scores[candidate.id] = scoreTool(candidate, { operation: contract.operation, requiresFreshness: options?.requiresFreshness ?? contract.temporalScope === 'current', capability: need.domain })
  const selected = candidates.slice().sort((a, b) => (scores[b.id]?.total ?? 0) - (scores[a.id]?.total ?? 0))[0]
  const executionStrategy = contract.executionRequirement === 'multi_source' ? 'independent multi-source acquisition and verification' : contract.toolRequired ? 'single best-capability tool with bounded recovery' : 'no tool execution'
  const evidenceRequirements = contract.evidenceRequirement === 'external_web' || contract.evidenceRequirement === 'multi_source' ? ['provenance', 'freshness', 'source quality', 'claim verification'] : contract.evidenceRequirement === 'live_system' ? ['live execution evidence', 'verification'] : []
  return { capability: need.domain, candidates, selected, scores, executionStrategy, evidenceRequirements }
}