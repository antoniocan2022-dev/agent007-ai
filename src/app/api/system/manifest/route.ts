import { NextResponse } from 'next/server'
import { getAllUpgrades, getUpgradeCounts, verifyIntegrity } from '@/lib/upgrade-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/manifest
 * Returns the permanent upgrade manifest — all upgrades applied to the system.
 * This endpoint is READ-ONLY and cannot be modified or reset by any operation.
 *
 * UPGRADE #185: Added ?summary mode. The full manifest is 219KB (all upgrade
 * descriptions). The AutonomyIntelligencePanel only needs 4 numbers:
 * totalUpgrades, totalTools, totalSubagents, totalProviders.
 * ?summary returns just those — ~100 bytes instead of 219KB.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const summaryOnly = url.searchParams.get('summary') === 'true'

  if (summaryOnly) {
    const upgrades = getAllUpgrades()
    return NextResponse.json({
      ok: true,
      totalUpgrades: upgrades.length,
      totalTools: 463,  // dynamic count would require importing tools.ts (circular dep)
      totalSubagents: 18,
      totalProviders: 5,
    })
  }

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
