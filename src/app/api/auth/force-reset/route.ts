import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/force-reset
 * 
 * DISABLED — system is locked to UPGRADE-ONLY mode.
 * Reset/delete operations are no longer available.
 * Only upgrades and improvements are allowed.
 * 
 * To change password, use /api/auth/change-password (requires current password).
 * To reset password with code, use /api/auth/reset-password (requires email code).
 */
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: '🔒 System locked to UPGRADE-ONLY mode. Force-reset is permanently disabled. Use Settings → Change Password to update your password.',
  }, { status: 403 })
}
