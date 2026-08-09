'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, LockKeyhole, PlayCircle, RefreshCw, ShieldCheck } from 'lucide-react'

type RevenueAction = {
  id: string
  action: string
  status: 'pending' | 'approved' | 'executing' | 'done' | 'failed' | 'cancelled'
  attrs: Record<string, unknown> | null
  result: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

type RevenueExecutor = {
  id: string
  action: string
  capability: string
  enabled: boolean
}

const label = (action: string) => action.replace(/^revenue\./, '').replace(/:[^:]+$/, '').replaceAll('_', ' ')
const statusClass = (status: RevenueAction['status']) => {
  if (status === 'approved') return 'text-emerald-200 border-emerald-400/20 bg-emerald-400/[0.04]'
  if (status === 'pending') return 'text-amber-200 border-amber-400/20 bg-amber-400/[0.04]'
  if (status === 'failed') return 'text-red-200 border-red-400/20 bg-red-400/[0.04]'
  if (status === 'done') return 'text-cyan-200 border-cyan-400/20 bg-cyan-400/[0.04]'
  return 'text-[#9bb5d4] border-cyan-400/10 bg-white/[0.02]'
}

export function RevenueExecutionPanel() {
  const [actions, setActions] = useState<RevenueAction[]>([])
  const [executors, setExecutors] = useState<RevenueExecutor[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/revenue-execution', { cache: 'no-store' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Unable to load revenue execution queue.')
      setActions(Array.isArray(data?.actions) ? data.actions : [])
      setExecutors(Array.isArray(data?.executors) ? data.executors : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load revenue execution queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(timer)
  }, [load])

  const postOperation = async (operation: 'approve' | 'execute', id: string) => {
    setWorkingId(id)
    setError(null)
    try {
      const response = await fetch('/api/revenue-execution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, actionId: id }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || `${operation} failed.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : `${operation} failed.`)
    } finally {
      setWorkingId(null)
    }
  }

  const executorFor = (action: RevenueAction) => {
    const actionName = action.action.replace(/^revenue\./, '').split(':', 1)[0]
    return executors.find((executor) => executor.action === actionName) ?? null
  }

  return (
    <div className="rounded-2xl glass border border-cyan-400/15 p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#dfe7ff]"><ShieldCheck className="w-4 h-4 text-cyan-300" /> Revenue Execution Control</div>
          <p className="mt-1 text-[11px] text-[#7181aa]">Durable intent, approval, and authorized execution. Approval is not revenue.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="h-8 px-2.5 rounded-lg border border-cyan-400/15 bg-white/[0.02] text-[10px] text-cyan-200 flex items-center gap-1.5 disabled:opacity-50" aria-label="Refresh revenue execution queue">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.03] p-2"><div className="text-amber-200 font-semibold">Pending approval</div><div className="mt-1 text-lg text-[#dfe7ff]">{actions.filter((a) => a.status === 'pending').length}</div></div>
        <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.03] p-2"><div className="text-emerald-200 font-semibold">Approved</div><div className="mt-1 text-lg text-[#dfe7ff]">{actions.filter((a) => a.status === 'approved').length}</div></div>
      </div>

      {error && <div className="rounded-lg border border-red-400/20 bg-red-400/[0.04] p-2.5 text-[10px] text-red-200">{error}</div>}

      {actions.length === 0 && !loading ? (
        <div className="rounded-xl border border-cyan-400/10 bg-white/[0.02] p-4 text-center text-[11px] text-[#7181aa]">No revenue execution actions are waiting for operator attention.</div>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const executor = executorFor(action)
            return (
              <div key={action.id} className={`rounded-xl border p-3 ${statusClass(action.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs font-semibold capitalize"><Clock3 className="w-3.5 h-3.5 shrink-0" />{label(action.action)}</div>
                    <div className="mt-1 text-[9px] text-[#66779e]">{new Date(action.createdAt).toLocaleString()}</div>
                  </div>
                  <span className="text-[9px] uppercase tracking-wider shrink-0">{action.status}</span>
                </div>

                {action.status === 'pending' && (
                  <button onClick={() => void postOperation('approve', action.id)} disabled={workingId === action.id} className="mt-3 w-full h-8 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] text-[10px] text-emerald-200 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {workingId === action.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                    Approve for authorized execution
                  </button>
                )}

                {action.status === 'approved' && executor?.enabled && (
                  <button onClick={() => void postOperation('execute', action.id)} disabled={workingId === action.id} className="mt-3 w-full h-8 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.05] text-[10px] text-cyan-200 flex items-center justify-center gap-1.5 disabled:opacity-50">
                    {workingId === action.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <PlayCircle className="w-3 h-3" />}
                    Execute via {executor.id}
                  </button>
                )}

                {action.status === 'approved' && !executor?.enabled && (
                  <div className="mt-3 flex items-center gap-1.5 text-[9px] text-emerald-200"><LockKeyhole className="w-3 h-3" /> Approved. No enabled exact-match executor is currently configured.</div>
                )}

                {action.status === 'executing' && <div className="mt-3 text-[9px] text-cyan-200">Executor is processing this action.</div>}
                {action.status === 'done' && <div className="mt-3 text-[9px] text-cyan-200">External execution completed. Revenue still requires processor-backed verification.</div>}
              </div>
            )
          })}
        </div>
      )}

      <div className="text-[9px] text-[#59698f] border-t border-cyan-400/10 pt-3">Financial truth remains processor-backed Transaction evidence. This control never creates or counts revenue.</div>
    </div>
  )
}
