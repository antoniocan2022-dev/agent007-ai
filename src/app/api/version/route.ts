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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Vercel provides these env vars automatically when deployed via git
  // https://vercel.com/docs/projects/environment-variables/system-environment-variables
  const gitCommit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'unknown'
  const gitBranch = process.env.VERCEL_GIT_COMMIT_REF || 'main'
  const gitCommitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || ''
  const gitCommitDate = process.env.VERCEL_GIT_COMMIT_DATE || ''

  return NextResponse.json({
    version: 'upgrade-217',
    gitCommit,
    gitBranch,
    gitCommitMessage,
    buildDate: gitCommitDate || new Date().toISOString(),
    environment: process.env.VERCEL_ENV || (process.env.VERCEL ? 'production' : 'development'),
    region: process.env.VERCEL_REGION || 'local',
    nodeVersion: process.version,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
    timestamp: new Date().toISOString(),
  })
}
