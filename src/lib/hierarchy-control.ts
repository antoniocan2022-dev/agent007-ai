/**
 * Agent007 executable hierarchy control plane.
 *
 * The hierarchy is a runtime contract, not prompt text. Every delegated
 * subagent action must identify its immediate parent. The contract prevents
 * CEO->specialist bypasses and specialist self/cross-branch dispatches.
 */

export const ROOT_AGENT_ID = 'ceo' as const

/** Authoritative immediate reporting relationships for governed built-ins. */
export const HIERARCHY_PARENT = Object.freeze({
  vid: 'ceo',
  aurora: 'vid',
  vertex: 'vid',
  quantum: 'vid',
  scout: 'vid',
  hunt: 'scout',
  forge: 'vid',
  quill: 'aurora',
  prism: 'aurora',
  pulse: 'vid',
  echo: 'vid',
  legal: 'cybersecurity_r',
  banker: 'vid',
  trader: 'vid',
  cybersecurity_a: 'cybersecurity_r',
  cybersecurity_r: 'vid',
  developer: 'forge',
  qa_monitor: 'vid',
  external_uptime_monitor: 'vid',
} as const)

export type GovernedAgentId = keyof typeof HIERARCHY_PARENT | typeof ROOT_AGENT_ID

function normalize(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, '_')
}

export interface DelegationDecision {
  allowed: boolean
  parentId: string
  childId: string
  path: string[]
  reason: string
}

export function getParentId(agentId: string): string | undefined {
  return HIERARCHY_PARENT[normalize(agentId) as keyof typeof HIERARCHY_PARENT]
}

export function getDelegationPath(parentId: string, childId: string): string[] | null {
  const parent = normalize(parentId)
  const child = normalize(childId)
  if (parent === child) return null
  const path: string[] = [child]
  let current = child
  const seen = new Set<string>()

  while (current !== ROOT_AGENT_ID) {
    if (seen.has(current)) return null
    seen.add(current)
    const parentOfCurrent = getParentId(current)
    if (!parentOfCurrent) return null
    path.unshift(parentOfCurrent)
    if (parentOfCurrent === parent) return path
    current = parentOfCurrent
  }

  return parent === ROOT_AGENT_ID ? path : null
}

export function evaluateDelegation(parentId: string, childId: string, requireImmediate = true): DelegationDecision {
  const parent = normalize(parentId)
  const child = normalize(childId)
  const directParent = getParentId(child)
  const path = getDelegationPath(parent, child)

  if (parent === child) {
    return { allowed: false, parentId: parent, childId: child, path: [], reason: 'Self-dispatch is forbidden.' }
  }

  if (!path) {
    return { allowed: false, parentId: parent, childId: child, path: [], reason: `No governed delegation path exists from ${parent} to ${child}.` }
  }

  if (requireImmediate && directParent !== parent) {
    return {
      allowed: false,
      parentId: parent,
      childId: child,
      path,
      reason: `${parent} cannot bypass ${directParent}; ${child} must be delegated through its immediate leader.`,
    }
  }

  return { allowed: true, parentId: parent, childId: child, path, reason: 'Delegation follows the governed hierarchy.' }
}

export function assertDelegationAllowed(parentId: string, childId: string, requireImmediate = true): void {
  const decision = evaluateDelegation(parentId, childId, requireImmediate)
  if (!decision.allowed) throw new Error(`[HIERARCHY_BLOCKED] ${decision.reason}`)
}

export function validateHierarchy(): string[] {
  const errors: string[] = []
  const ids = Object.keys(HIERARCHY_PARENT)
  if (new Set(ids).size !== ids.length) errors.push('Duplicate hierarchy agent IDs.')
  for (const id of ids) {
    const parent = getParentId(id)
    if (!parent || id === parent) errors.push(`Invalid parent relationship for ${id}.`)
    if (parent !== ROOT_AGENT_ID && !HIERARCHY_PARENT[parent as keyof typeof HIERARCHY_PARENT]) {
      errors.push(`Missing governed parent profile for ${id}: ${parent}.`)
    }
    if (!getDelegationPath(ROOT_AGENT_ID, id)) errors.push(`No path from CEO to ${id}.`)
  }
  if (evaluateDelegation('ceo', 'vid').allowed !== true) errors.push('CEO → VID must be allowed.')
  if (evaluateDelegation('ceo', 'quill').allowed !== false) errors.push('CEO → QUILL bypass must be blocked.')
  if (evaluateDelegation('aurora', 'quill').allowed !== true) errors.push('AURORA → QUILL must be allowed.')
  if (evaluateDelegation('forge', 'developer').allowed !== true) errors.push('FORGE → Developer must be allowed.')
  return errors
}
