/**
 * Agent007 autonomous mission state machine.
 *
 * Pure domain rules: no persistence, scheduling, LLM, or execution side effects.
 * Invalid transitions throw so callers cannot silently skip lifecycle controls.
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
  { from: 'EXECUTING', event: 'FAIL', to: 'FAILED' },
  { from: 'EXECUTING', event: 'BLOCK', to: 'BLOCKED' },
  { from: 'WAITING', event: 'RESUME', to: 'EXECUTING' },
  { from: 'WAITING', event: 'BLOCK', to: 'BLOCKED' },
  { from: 'VERIFYING', event: 'COMPLETE', to: 'COMPLETED', requiresVerification: true },
  { from: 'VERIFYING', event: 'RECOVER', to: 'RECOVERING' },
  { from: 'VERIFYING', event: 'FAIL', to: 'FAILED' },
  { from: 'RECOVERING', event: 'START', to: 'EXECUTING' },
  { from: 'RECOVERING', event: 'VERIFY', to: 'VERIFYING', requiresVerification: true },
  { from: 'RECOVERING', event: 'FAIL', to: 'FAILED' },
  { from: 'BLOCKED', event: 'RECOVER', to: 'RECOVERING' },
  { from: 'FAILED', event: 'RECOVER', to: 'RECOVERING' },
  { from: 'PROPOSED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'QUEUED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'PLANNING', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'AUTHORIZED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'WAITING', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'BLOCKED', event: 'CANCEL', to: 'CANCELLED' },
  { from: 'FAILED', event: 'CANCEL', to: 'CANCELLED' },
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
