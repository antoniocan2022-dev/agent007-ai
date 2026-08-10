/**
 * Agent007 autonomous mission state machine.
 *
 * This is a domain-level state model. It intentionally contains no persistence
 * or execution side effects so the orchestrator can adopt it without coupling
 * storage, scheduling, and tool execution into the transition rules.
 */

export const MISSION_STATES = [
  'PROPOSED',
  'QUEUED',
  'PLANNING',
  'AUTHORIZED',
  'EXECUTING',
  'WAITING',
  'VERIFYING',
  'RECOVERING',
  'COMPLETED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
] as const

export type MissionState = (typeof MISSION_STATES)[number]

export type MissionEvent =
  | 'QUEUE'
  | 'PLAN'
  | 'AUTHORIZE'
  | 'START'
  | 'WAIT'
  | 'RESUME'
  | 'VERIFY'
  | 'RECOVER'
  | 'COMPLETE'
  | 'BLOCK'
  | 'FAIL'
  | 'CANCEL'

export interface MissionTransition {
  from: MissionState
  event: MissionEvent
  to: MissionState
  requiresVerification?: boolean
}

const TRANSITIONS: readonly MissionTransition[] = [
  { from: 'PROPOSED', event: 'QUEUE', to: 'QUEUED' },
  { from: 'QUEUED', event: 'PLAN', to: 'PLANNING' },
  { from: 'PLANNING', event: 'AUTHORIZE', to: 'AUTHORIZED' },
  { from: 'AUTHORIZED', event: 'START', to: 'EXECUTING' },
  { from: 'EXECUTING', event: 'WAIT', to: 'WAITING' },
  { from: 'EXECUTING', event: 'VERIFY', to: 'VERIFYING', requiresVerification: true },
  { from: 'EXECUTING', event: 'RECOVER', to: 'RECOVERING' },
  { from: 'WAITING', event: 'RESUME', to: 'EXECUTING' },
  { from: 'WAITING', event: 'BLOCK', to: 'BLOCKED' },
  { from: 'VERIFYING', event: 'COMPLETE', to: 'COMPLETED', requiresVerification: true },
  { from: 'VERIFYING', event: 'RECOVER', to: 'RECOVERING' },
  { from: 'RECOVERING', event: 'START', to: 'EXECUTING' },
  { from: 'RECOVERING', event: 'VERIFY', to: 'VERIFYING', requiresVerification: true },
  { from: 'RECOVERING', event: 'FAIL', to: 'FAILED' },
  { from: 'PROPOSED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'QUEUED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'PLANNING', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'AUTHORIZED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'WAITING', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'BLOCKED', event: 'RECOVER', to: 'RECOVERING' },
] as const

const transitionMap = new Map<string, MissionTransition>(
  TRANSITIONS.map((transition) => [`${transition.from}:${transition.event}`, transition]),
)

export function canTransition(state: MissionState, event: MissionEvent): boolean {
  return transitionMap.has(`${state}:${event}`)
}

export function transitionMission(state: MissionState, event: MissionEvent): MissionState {
  const transition = transitionMap.get(`${state}:${event}`)
  if (!transition) {
    throw new Error(`Invalid mission transition: ${state} --${event}--> ?`)
  }
  return transition.to
}

export function isTerminalMissionState(state: MissionState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED'
}

export function requiresIndependentVerification(state: MissionState, event: MissionEvent): boolean {
  return transitionMap.get(`${state}:${event}`)?.requiresVerification === true
}

export function getAllowedMissionEvents(state: MissionState): MissionEvent[] {
  return TRANSITIONS.filter((transition) => transition.from === state).map((transition) => transition.event)
}
