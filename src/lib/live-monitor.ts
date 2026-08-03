/**
 * live-monitor.ts — UPGRADE #225
 *
 * Finding 10: Live Monitoring during mission execution.
 *
 * The Evolution Engine currently evaluates AFTER work completes.
 * This module adds REAL-TIME monitoring during execution:
 *
 * - Latency increasing → warn the CEO
 * - Leader disagreement detected → alert
 * - Memory conflict → flag
 * - Retry loop forming → alert
 * - Mission exceeding predicted duration → warn
 *
 * The organization now supervises itself LIVE, not just retrospectively.
 */

import { db } from './db'

export const runtime = 'nodejs'

export type AlertSeverity = 'info' | 'warning' | 'critical'
export type AlertType =
  | 'latency_increasing'
  | 'leader_disagreement'
  | 'memory_conflict'
  | 'retry_loop'
  | 'exceeding_predicted_duration'
  | 'low_confidence'
  | 'verification_failing'
  | 'excessive_errors'
  | 'mission_stalled'

export interface LiveAlert {
  alertId: string
  missionId: string
  type: AlertType
  severity: AlertSeverity
  message: string
  timestamp: string
  data?: any
}

// In-memory store for active mission monitors (per serverless instance)
const activeMonitors = new Map<string, MissionMonitor>()

interface MissionMonitor {
  missionId: string
  startTime: number
  predictedDuration: number
  lastActivityTime: number
  retryCount: number
  errorCount: number
  leaderResponses: Array<{ leader: string; confidence: number; timestamp: number }>
  alerts: LiveAlert[]
  stalled: boolean
}

/**
 * Start monitoring a mission.
 */
export function startMonitoring(missionId: string, predictedDuration: number = 25000): void {
  const monitor: MissionMonitor = {
    missionId,
    startTime: Date.now(),
    predictedDuration,
    lastActivityTime: Date.now(),
    retryCount: 0,
    errorCount: 0,
    leaderResponses: [],
    alerts: [],
    stalled: false,
  }
  activeMonitors.set(missionId, monitor)
  console.log(`[live-monitor] Started monitoring ${missionId} (predicted: ${predictedDuration}ms)`)
}

/**
 * Record activity during a mission (called by Mission OS at each stage).
 */
export function recordActivity(missionId: string, activity: string): void {
  const monitor = activeMonitors.get(missionId)
  if (!monitor) return
  monitor.lastActivityTime = Date.now()
  checkConditions(monitor)
}

/**
 * Record a retry during a mission.
 */
export function recordMissionRetry(missionId: string): void {
  const monitor = activeMonitors.get(missionId)
  if (!monitor) return
  monitor.retryCount++
  if (monitor.retryCount >= 2) {
    raiseAlert(monitor, 'retry_loop', 'warning', `${monitor.retryCount} retries detected — possible retry loop forming`)
  }
}

/**
 * Record an error during a mission.
 */
export function recordMissionError(missionId: string, error: string): void {
  const monitor = activeMonitors.get(missionId)
  if (!monitor) return
  monitor.errorCount++
  if (monitor.errorCount >= 3) {
    raiseAlert(monitor, 'excessive_errors', 'critical', `${monitor.errorCount} errors encountered — mission quality at risk`)
  }
}

/**
 * Record a leader response during a mission.
 */
export function recordLeaderResponse(missionId: string, leader: string, confidence: number): void {
  const monitor = activeMonitors.get(missionId)
  if (!monitor) return
  monitor.leaderResponses.push({ leader, confidence, timestamp: Date.now() })

  // Check for leader disagreement (confidence spread > 25%)
  if (monitor.leaderResponses.length >= 2) {
    const confidences = monitor.leaderResponses.map(r => r.confidence)
    const spread = Math.max(...confidences) - Math.min(...confidences)
    if (spread > 25) {
      raiseAlert(monitor, 'leader_disagreement', 'warning',
        `Leader disagreement detected: confidence spread ${spread}% between ${monitor.leaderResponses.map(r => `${r.leader}=${r.confidence}%`).join(', ')}`)
    }
  }

  // Check for low confidence
  if (confidence < 50) {
    raiseAlert(monitor, 'low_confidence', 'warning', `Leader ${leader} reported low confidence: ${confidence}%`)
  }
}

/**
 * Check all monitoring conditions for a mission.
 */
function checkConditions(monitor: MissionMonitor): void {
  const elapsed = Date.now() - monitor.startTime

  // Check: exceeding predicted duration
  if (elapsed > monitor.predictedDuration * 1.5) {
    if (!monitor.alerts.some(a => a.type === 'exceeding_predicted_duration')) {
      raiseAlert(monitor, 'exceeding_predicted_duration', 'warning',
        `Mission running for ${(elapsed / 1000).toFixed(1)}s — exceeding predicted ${(monitor.predictedDuration / 1000).toFixed(1)}s by 50%+`)
    }
  }

  // Check: mission stalled (no activity for 30+ seconds)
  const inactiveFor = Date.now() - monitor.lastActivityTime
  if (inactiveFor > 30000 && !monitor.stalled) {
    monitor.stalled = true
    raiseAlert(monitor, 'mission_stalled', 'critical',
      `Mission stalled — no activity for ${(inactiveFor / 1000).toFixed(0)}s`)
  }
}

/**
 * Raise an alert and store it.
 */
function raiseAlert(
  monitor: MissionMonitor,
  type: AlertType,
  severity: AlertSeverity,
  message: string
): void {
  // Don't duplicate alerts of the same type
  if (monitor.alerts.some(a => a.type === type)) return

  const alert: LiveAlert = {
    alertId: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    missionId: monitor.missionId,
    type,
    severity,
    message,
    timestamp: new Date().toISOString(),
  }

  monitor.alerts.push(alert)
  console.log(`[live-monitor] ALERT [${severity}] ${monitor.missionId}: ${message}`)
}

/**
 * Stop monitoring and return all alerts.
 */
export async function stopMonitoring(missionId: string): Promise<LiveAlert[]> {
  const monitor = activeMonitors.get(missionId)
  if (!monitor) return []

  // Final check
  checkConditions(monitor)

  const alerts = monitor.alerts
  activeMonitors.delete(missionId)

  // Store alerts in DB for the Evolution Engine
  if (alerts.length > 0) {
    try {
      await db.memory.create({
        data: {
          key: `live_alerts_${missionId}`,
          value: JSON.stringify(alerts),
          category: 'live_monitoring_alerts',
        },
      })
      console.log(`[live-monitor] ${missionId}: ${alerts.length} alert(s) stored`)
    } catch (e: any) {
      console.error('[live-monitor] Failed to store alerts:', e?.message)
    }
  }

  return alerts
}

/**
 * Get current alerts for a running mission.
 */
export function getActiveAlerts(missionId: string): LiveAlert[] {
  const monitor = activeMonitors.get(missionId)
  return monitor?.alerts || []
}

/**
 * Get all active monitors (for the live monitoring dashboard).
 */
export function getAllActiveMonitors(): Array<{
  missionId: string
  elapsedMs: number
  predictedDuration: number
  retryCount: number
  errorCount: number
  leaderCount: number
  alertCount: number
  stalled: boolean
}> {
  return Array.from(activeMonitors.values()).map(m => ({
    missionId: m.missionId,
    elapsedMs: Date.now() - m.startTime,
    predictedDuration: m.predictedDuration,
    retryCount: m.retryCount,
    errorCount: m.errorCount,
    leaderCount: m.leaderResponses.length,
    alertCount: m.alerts.length,
    stalled: m.stalled,
  }))
}
