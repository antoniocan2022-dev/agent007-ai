import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { isInteractiveActive } from '@/lib/load-tracker'
import { runOrchestrator } from '@/lib/orchestrator'
import { waitUntil } from '@vercel/functions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function backgroundFire(promise: Promise<any>) {
  waitUntil(promise.catch(() => {}))
}

/**
 * POST /api/schedules/tick — UPGRADE #136
 * Called by: (1) dashboard polling every 60s, (2) Vercel Cron daily at 9AM
 *
 * UPGRADE #136: Now ACTUALLY EXECUTES scheduled prompts.
