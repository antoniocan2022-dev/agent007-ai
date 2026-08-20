import { NextResponse } from 'next/server'
import { getAllUpgrades, getUpgradeCounts, verifyIntegrity } from '@/lib/upgrade-manifest'
import { getSystemManifest } from '@/lib/system-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/manifest
 * Combines the permanent upgrade catalog with the canonical live system manifest.
 * `?summary=true` intentionally returns only machine-relevant live counts.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const summaryOnly = url.searchParams.get('summary') === 'true'
  const system = getSystemManifest()

  if (summaryOnly) {
    const upgrades = getAllUpgrades()
    return NextResponse.json({
      ok: true,
      manifest: system,
      totalUpgrades: upgrades.length,
      totalTools: system.capabilities.toolCount,
      totalSubagents: system.organization.specialistCount,
      totalProviders: null,
      timestamp: system.generatedAt,
    }, { headers: { 'cache-control': 'no-store' } })
  }

  const upgrades = getAllUpgrades()
  const counts = getUpgradeCounts()
  const integrity = verifyIntegrity()

  return NextResponse.json({
    ok: true,
    manifest: system,
    totalUpgrades: upgrades.length,
    upgrades,
    countsByCategory: counts,
    integrity,
    permanent: true,
    timestamp: system.generatedAt,
  }, { headers: { 'cache-control': 'no-store' } })
}
