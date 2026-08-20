import { NextResponse } from 'next/server'
import { getAllUpgrades, getUpgradeCounts, verifyIntegrity } from '@/lib/upgrade-manifest'
import { getLiveSystemManifest } from '@/lib/system-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/system/manifest
 * Returns the canonical code manifest plus the effective runtime organization.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const summaryOnly = url.searchParams.get('summary') === 'true'
  const system = await getLiveSystemManifest()
  const upgrades = getAllUpgrades()

  if (summaryOnly) {
    return NextResponse.json({
      ok: true,
      manifest: system,
      totalUpgrades: upgrades.length,
      totalTools: system.capabilities.toolCount,
      totalSubagents: system.organization.specialistCount,
      totalProviders: system.capabilities.providerCount,
      configuredProviders: system.capabilities.configuredProviderCount,
      healthyProviders: system.capabilities.healthyProviderCount,
      timestamp: system.generatedAt,
    }, { headers: { 'cache-control': 'no-store' } })
  }

  return NextResponse.json({
    ok: true,
    manifest: system,
    totalUpgrades: upgrades.length,
    upgrades,
    countsByCategory: getUpgradeCounts(),
    integrity: verifyIntegrity(),
    permanent: true,
    timestamp: system.generatedAt,
  }, { headers: { 'cache-control': 'no-store' } })
}
