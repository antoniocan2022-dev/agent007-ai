/**
 * /api/version — UPGRADE #212
 *
 * Dedicated version endpoint for production auditing.
 * Returns build metadata: version, git commit, build date, environment.
 *
 * GET /api/version
 *
 * Response:
 * {
 *   "version": "upgrade-212",
 *   "gitCommit": "abc123",
 *   "gitBranch": "main",
 *   "buildDate": "2026-08-02T...",
 *   "environment": "production",
 *   "region": "iad1",
 *   "nodeVersion": "v24.18.0",
 *   "timestamp": "2026-08-02T..."
 * }
 *
 * This endpoint is PUBLIC (no auth) so external auditors can verify
 * the deployed version without logging in.
 */
import { NextResponse } from 'next/server'
import { execSync } from 'node:child_process'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let gitCommit = 'unknown'
  let gitBranch = 'unknown'

  try {
    gitCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {}
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
  } catch {}

  return NextResponse.json({
    version: 'upgrade-212',
    gitCommit,
    gitBranch,
    buildDate: process.env.VERCEL_GIT_COMMIT_DATE || new Date().toISOString(),
    environment: process.env.VERCEL_ENV || (process.env.VERCEL ? 'production' : 'development'),
    region: process.env.VERCEL_REGION || 'local',
    nodeVersion: process.version,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
    timestamp: new Date().toISOString(),
  })
}
