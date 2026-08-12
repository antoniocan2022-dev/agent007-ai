#!/usr/bin/env bun
import { SUBAGENTS } from '../src/lib/subagents'
import { getAllGovernanceProfiles, validateBuiltinGovernanceCoverage } from '../src/lib/subagent-governance'
import { PROVIDER_PRIORITY, validateProviderPriority } from '../src/lib/provider-intelligence-policy'

const errors = [
  ...validateBuiltinGovernanceCoverage(SUBAGENTS),
  ...validateProviderPriority(PROVIDER_PRIORITY),
]

const builtinCount = SUBAGENTS.filter((agent) => agent.isBuiltin !== false).length
const duplicateIds = SUBAGENTS.length - new Set(SUBAGENTS.map((agent) => agent.id)).size

if (duplicateIds > 0) errors.push(`Duplicate subagent IDs detected: ${duplicateIds}`)
if (getAllGovernanceProfiles().length !== builtinCount) errors.push(`Governance profile count (${getAllGovernanceProfiles().length}) does not match built-in subagent count (${builtinCount})`)

if (errors.length > 0) {
  console.error('Subagent Governance validation FAILED:')
  errors.forEach((error) => console.error(`- ${error}`))
  process.exit(1)
}

console.log(`Subagent Governance validation PASSED: ${builtinCount} built-in subagents, ${PROVIDER_PRIORITY.join(' → ')} provider priority.`)
