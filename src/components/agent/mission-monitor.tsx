'use client'

/**
 * MissionMonitor.tsx — UPGRADE #144 (Rec 2 — Real-time Mission Monitor)
 * ===================================================================
 * A dashboard widget that shows LIVE mission status:
 *   - Active missions with current stage
 *   - Elapsed time + ETA per mission
 *   - CEO watchdog verdict (healthy / warning / critical)
 *   - Real-time pulse animation when a team is working
 *   - Auto-refresh every 5 seconds
 *
 * Polls /api/missions/heartbeats every 5s.
 */

import { useEffect, useState, useCallback } from 'react'
import { Activity, AlertTriangle, CheckCircle, Clock, Loader2, Pause, XCircle, Zap } from 'lucide-react'

interface StageTiming {
  stageId: string
  stageName: string
  team: string
  leader: string
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  rounds: number
  finalScore: number | null
}

interface Heartbeat {
  missionId: string
  missionTitle: string
  pipelineType: string
  status: 'idle' | 'working' | 'paused_owner' | 'stuck' | 'errored' | 'completed' | 'failed'
  currentStage: {
    stageId: string
    stageNumber: number
    totalStages: number
    name: string
    team: string
    leader: string
    startedAt: string | null
    elapsedMs: number | null
    round: number
    maxRounds: number
  } | null
  completedStages: StageTiming[]
  estimatedRemainingMs: number | null
  estimatedCompletionAt: string | null
  lastActivityAt: string | null
  lastError: string | null
  ceoWatchdog: {
    verdict: 'healthy' | 'warning' | 'critical'
    message: string
    checkedAt: string
  }
  updatedAt: string
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function statusIcon(status: Heartbeat['status']) {
  switch (status) {
    case 'working':       return <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
    case 'paused_owner':  return <Pause className="w-3.5 h-3.5 text-amber-400" />
    case 'stuck':         return <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
    case 'errored':       return <XCircle className="w-3.5 h-3.5 text-red-400" />
    case 'failed':        return <XCircle className="w-3.5 h-3.5 text-red-500" />
    case 'completed':     return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
    default:              return <Activity className="w-3.5 h-3.5 text-slate-400" />
  }
}

function watchdogColor(verdict: Heartbeat['ceoWatchdog']['verdict']): string {
  switch (verdict) {
    case 'healthy':   return 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5'
    case 'warning':   return 'text-amber-400 border-amber-400/30 bg-amber-400/5'
    case 'critical':  return 'text-red-400 border-red-400/30 bg-red-400/5'
  }
}

export function MissionMonitor() {
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/missions/heartbeats', {
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      if (data.ok) {
        setHeartbeats(data.heartbeats ?? [])
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false)
      setLastUpdated(new Date())
    }
  }, [])

  useEffect(() => {
    refresh()
    // Poll every 5 seconds while the dashboard is mounted
    const id = setInterval(refresh, 5000)
    return () => clearInterval(id)
  }, [refresh])

  const activeMissions = heartbeats.filter((h) => h.status !== 'completed' && h.status !== 'failed')
  const completedMissions = heartbeats.filter((h) => h.status === 'completed' || h.status === 'failed')

  return (
    <div className="rounded-lg border border-cyan-400/20 bg-slate-900/40 p-4 backdrop-blur">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-cyan-200 tracking-wide">
            Mission Monitor
          </h3>
          <span className="text-[10px] text-slate-400 ml-2">
            ({activeMissions.length} active · {completedMissions.length} done)
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
          <span>live · 5s</span>
          {lastUpdated && (
            <span className="ml-1">· {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      {heartbeats.length === 0 && !loading && (
        <div className="text-xs text-slate-500 py-6 text-center">
          No active missions. Type <code className="px-1 py-0.5 rounded bg-slate-800 text-cyan-300">start mission: generic: &lt;your objective&gt;</code> in the chat to begin.
        </div>
      )}

      {/* Active missions */}
      <div className="space-y-2">
        {activeMissions.map((hb) => (
          <div
            key={hb.missionId}
            className={`rounded-md border p-2.5 ${watchdogColor(hb.ceoWatchdog.verdict)}`}
          >
            {/* Header row */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                {statusIcon(hb.status)}
                <span className="text-xs font-semibold truncate">
                  {hb.missionTitle.slice(0, 60)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider shrink-0">
                {hb.pipelineType}
              </span>
            </div>

            {/* Stage progress bar */}
            {hb.currentStage && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                  <span>
                    Stage {hb.currentStage.stageNumber}/{hb.currentStage.totalStages}: {hb.currentStage.name}
                  </span>
                  <span>
                    Round {hb.currentStage.round}/{hb.currentStage.maxRounds}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all duration-500"
                    style={{
                      width: `${(hb.completedStages.length / hb.currentStage.totalStages) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Live indicators */}
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
              <div className="flex flex-col">
                <span className="text-slate-500 uppercase">Elapsed</span>
                <span className="flex items-center gap-1 text-slate-300 font-mono">
                  <Clock className="w-3 h-3" />
                  {hb.currentStage?.elapsedMs ? formatDuration(hb.currentStage.elapsedMs) : '—'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 uppercase">ETA</span>
                <span className="flex items-center gap-1 text-slate-300 font-mono">
                  <Zap className="w-3 h-3" />
                  {hb.estimatedRemainingMs ? formatDuration(hb.estimatedRemainingMs) : '—'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 uppercase">Team</span>
                <span className="text-slate-300 font-mono uppercase">
                  {hb.currentStage?.team ?? '—'}
                </span>
              </div>
            </div>

            {/* CEO Watchdog */}
            <div className={`mt-2 px-2 py-1 rounded text-[10px] ${watchdogColor(hb.ceoWatchdog.verdict)}`}>
              <span className="font-semibold uppercase">CEO Watchdog:</span>{' '}
              <span>{hb.ceoWatchdog.message}</span>
            </div>

            {/* Error */}
            {hb.lastError && (
              <div className="mt-1.5 px-2 py-1 rounded text-[10px] text-red-300 bg-red-900/20 border border-red-500/20">
                <span className="font-semibold">Error:</span> {hb.lastError}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Completed missions (collapsed) */}
      {completedMissions.length > 0 && (
        <details className="mt-3">
          <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">
            Completed missions ({completedMissions.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {completedMissions.map((hb) => (
              <div
                key={hb.missionId}
                className="rounded-md border border-slate-700/40 bg-slate-800/20 p-2"
              >
                <div className="flex items-center gap-1.5">
                  {statusIcon(hb.status)}
                  <span className="text-xs text-slate-300 truncate">
                    {hb.missionTitle.slice(0, 60)}
                  </span>
                  <span className="text-[10px] text-slate-500 ml-auto">
                    {hb.completedStages.length} stages
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
