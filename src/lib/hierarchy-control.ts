/**
 * Agent007 executable hierarchy control plane.
 *
 * Agent-to-agent delegation is strictly parent -> immediate child. The human
 * owner is an external oversight authority above the CEO and may directly
 * query a governed leader without changing the organizational reporting line.
 */

export const ROOT_AGENT_ID = 'ceo' as const
export const OWNER_AUTHORITY_ID = 'owner' as const

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

export type DelegationAuthority = 'agent' | 'owner' | 'system'
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
  authority: DelegationAuthority
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

export function evaluateDelegation(
  parentId: string,
  childId: string,
  requireImmediate = true,
  authority: DelegationAuthority = 'agent',
): DelegationDecision {
  const parent = normalize(parentId)
  const child = normalize(childId)
  const directParent = getParentId(child)
  const path = getDelegationPath(parent, child)

  if (authority === 'owner' && parent === OWNER_AUTHORITY_ID) {
    if (!directParent) {
      return { allowed: false, parentId: parent, childId: child, path: [], reason: `Unknown governed child: ${child}.`, authority }
    }
    return {
      allowed: true,
      parentId: parent,
      childId: child,
      path: [parent, child],
      reason: 'Owner oversight authority permits direct leader/specialist query without changing the reporting line.',
      authority,
    }
  }

  if (authority === 'system' && parent === 'system') {
    if (!directParent) {
      return { allowed: false, parentId: parent, childId: child, path: [], reason: `Unknown governed child: ${child}.`, authority }
    }
    return {
      allowed: true,
      parentId: parent,
      childId: child,
      path: [parent, child],
      reason: 'System control-plane authority permits governed operational execution.',
      authority,
    }
  }

  if (parent === child) {
    return { allowed: false, parentId: parent, childId: child, path: [], reason: 'Self-dispatch is forbidden.', authority }
  }

  if (!path) {
    return { allowed: false, parentId: parent, childId: child, path: [], reason: `No governed delegation path exists from ${parent} to ${child}.`, authority }
  }

  if (requireImmediate && directParent !== parent) {
    return {
      allowed: false,
      parentId: parent,
      childId: child,
      path,
      reason: `${parent} cannot bypass ${directParent}; ${child} must be delegated through its immediate leader.`,
      authority,
    }
  }

  return { allowed: true, parentId: parent, childId: child, path, reason: 'Delegation follows the governed hierarchy.', authority }
}

export function assertDelegationAllowed(
  parentId: string,
  childId: string,
  requireImmediate = true,
  authority: DelegationAuthority = 'agent',
): void {
  const decision = evaluateDelegation(parentId, childId, requireImmediate, authority)
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
  if (!evaluateDelegation('ceo', 'vid').allowed) errors.push('CEO → VID must be allowed.')
  if (evaluateDelegation('ceo', 'quill').allowed) errors.push('CEO → QUILL bypass must be blocked.')
  if (!evaluateDelegation('aurora', 'quill').allowed) errors.push('AURORA → QUILL must be allowed.')
  if (!evaluateDelegation('forge', 'developer').allowed) errors.push('FORGE → Developer must be allowed.')
  if (!evaluateDelegation('owner', 'quill', true, 'owner').allowed) errors.push('Owner oversight → QUILL must be allowed.')
  return errors
}
