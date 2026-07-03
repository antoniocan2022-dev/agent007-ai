import { NextResponse } from 'next/server'
import { getAllUpgrades, getUpgradeCounts, verifyIntegrity } from '@/lib/upgrade-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/manifest
 * Returns the permanent upgrade manifest — all upgrades applied to the system.
 * This endpoint is READ-ONLY and cannot be modified or reset by any operation.
 */
export async function GET() {
  const upgrades = getAllUpgrades()
  const counts = getUpgradeCounts()
  const integrity = verifyIntegrity()

  return NextResponse.json({
    ok: true,
    totalUpgrades: upgrades.length,
    upgrades,
    countsByCategory: counts,
    integrity,
    permanent: true,
    message: 'All upgrades are PERMANENT. Reset/delete operations are disabled. To modify, owner must authorize via SMS or Google Authenticator.',
    timestamp: new Date().toISOString(),
  })
}
