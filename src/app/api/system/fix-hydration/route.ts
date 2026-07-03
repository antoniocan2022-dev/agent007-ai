import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/system/fix-hydration
 *
 * Agent007's hydration error fixer. Hydration errors happen when:
 * 1. Stale .next cache — server serves old HTML, client has new code
 * 2. typeof window checks during render
 * 3. Date.now() / Math.random() during render
 * 4. Browser extensions modifying HTML
 *
 * This endpoint:
 * 1. Clears the .next build cache
 * 2. Scans login + dashboard pages for common hydration triggers
 * 3. Returns a diagnostic report
 *
 * Body: { autoFix?: boolean }
 * Returns: { ok, fixed, diagnosis, recommendations }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const autoFix = body.autoFix !== false

    const diagnosis: Array<{ file: string; issue: string; severity: 'low' | 'medium' | 'high' }> = []
    const fixes: string[] = []

    // 1. Clear .next cache (always do this — it's the #1 cause of hydration errors)
    if (autoFix) {
      try {
        const nextDir = path.join(process.cwd(), '.next')
        if (fs.existsSync(nextDir)) {
          fs.rmSync(nextDir, { recursive: true, force: true })
          fixes.push('Cleared .next build cache (forces fresh recompile)')
        }
      } catch (e: any) {
        fixes.push(`Could not clear .next cache: ${e?.message ?? e}`)
      }
    }

    // 2. Scan login page for hydration triggers
    const filesToScan = [
      'src/app/login/page.tsx',
      'src/app/page.tsx',
      'src/components/agent/tabs/dashboard-tab.tsx',
      'src/components/agent/tabs/settings-tab.tsx',
    ]

    for (const relPath of filesToScan) {
      const fullPath = path.join(process.cwd(), relPath)
      if (!fs.existsSync(fullPath)) continue

      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')

        // Check for typeof window during render (not inside useEffect/handlers)
        lines.forEach((line, i) => {
          // Skip comments
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return

          // Check for typeof window OUTSIDE of useEffect/handlers
          if (line.includes('typeof window') && !line.includes('useEffect') && !line.includes('onClick') && !line.includes('onToggle')) {
            // Check if it's inside a function that runs during render
            const isRenderContext = !line.includes('=>') && !line.includes('function')
            if (isRenderContext) {
              diagnosis.push({
                file: relPath,
                issue: `Line ${i + 1}: typeof window check outside event handler — can cause hydration mismatch`,
                severity: 'medium',
              })
            }
          }

          // Check for Date.now() / Math.random() during render
          if ((line.includes('Date.now()') || line.includes('Math.random()')) && !line.includes('useEffect') && !line.includes('onClick')) {
            diagnosis.push({
              file: relPath,
              issue: `Line ${i + 1}: Date.now()/Math.random() outside useEffect — causes hydration mismatch`,
              severity: 'high',
            })
          }

          // Check for new Date() during render (not in useEffect)
          if (line.includes('new Date()') && !line.includes('useEffect') && !line.includes('onClick') && !line.includes('function') && !line.includes('=>')) {
            diagnosis.push({
              file: relPath,
              issue: `Line ${i + 1}: new Date() outside useEffect/handler — can cause hydration mismatch if rendered`,
              severity: 'medium',
            })
          }
        })

        // Check for suppressHydrationWarning on version/timestamp text
        if (relPath === 'src/app/login/page.tsx') {
          if (!content.includes('suppressHydrationWarning')) {
            diagnosis.push({
              file: relPath,
              issue: 'No suppressHydrationWarning found — add to version text and any dynamic content',
              severity: 'low',
            })
          } else {
            diagnosis.push({
              file: relPath,
              issue: 'suppressHydrationWarning is present (good)',
              severity: 'low',
            })
          }
        }
      } catch (e: any) {
        diagnosis.push({
          file: relPath,
          issue: `Could not scan: ${e?.message ?? e}`,
          severity: 'low',
        })
      }
    }

    // 3. Generate recommendations
    const recommendations: string[] = []
    if (diagnosis.some((d) => d.severity === 'high')) {
      recommendations.push('HIGH: Remove Date.now()/Math.random() from render context — move to useEffect')
    }
    if (diagnosis.some((d) => d.severity === 'medium')) {
      recommendations.push('MEDIUM: Move typeof window checks into event handlers or useEffect')
    }
    recommendations.push('Clear .next cache (done automatically)' + (fixes.length > 0 ? ' ✓' : ''))
    recommendations.push('Hard-refresh browser: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)')
    recommendations.push('If error persists, check browser extensions that modify HTML')

    const hasHighSeverity = diagnosis.some((d) => d.severity === 'high')

    return NextResponse.json({
      ok: true,
      fixed: fixes.length > 0,
      cacheCleared: fixes.some((f) => f.includes('Cleared .next')),
      diagnosis,
      fixes,
      recommendations,
      message: hasHighSeverity
        ? 'Hydration cache cleared. HIGH severity issues found — see diagnosis. Agent007 should fix the flagged lines.'
        : fixes.length > 0
          ? '✅ Hydration fix applied — .next cache cleared. Hard-refresh your browser. The page will recompile fresh on next load.'
          : 'No cache to clear. Check diagnosis for other issues.',
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e), fixed: false },
      { status: 500 }
    )
  }
}
