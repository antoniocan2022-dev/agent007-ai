import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getIncomeSettings, getNotificationSettings, getAllCustomSettings, setCustomSetting } from '@/lib/settings'
import { isEmailConfigured } from '@/lib/email'
import { UPGRADE_MANIFEST, verifyIntegrity } from '@/lib/upgrade-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/system/self-heal
 *
 * Agent007's self-healing toolkit. Performs diagnostic + repair actions.
 *
 * Body: { action: 'diagnose' | 'repair_dashboard' | 'repair_login' | 'repair_communication' | 'restore_upgrades' | 'verify_integrity' | 'full_repair' }
 *
 * Returns: { ok, action, results, summary }
 */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady()
    const body = await req.json().catch(() => ({}))
    const action = (body.action as string) ?? 'diagnose'

    const results: Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

    switch (action) {
      case 'diagnose': {
        // Run a full diagnostic
        results.push(...(await diagnoseSystem()))
        break
      }

      case 'repair_dashboard': {
        results.push(...(await repairDashboard()))
        break
      }

      case 'repair_login': {
        results.push(...(await repairLogin()))
        break
      }

      case 'repair_communication': {
        results.push(...(await repairCommunication()))
        break
      }

      case 'restore_upgrades': {
        results.push(...(await restoreUpgrades()))
        break
      }

      case 'verify_integrity': {
        const integrity = verifyIntegrity()
        results.push({
          step: 'integrity_check',
          status: integrity.ok ? 'pass' : 'fail',
          detail: `${integrity.total} upgrades verified, ${integrity.missing.length} missing`,
        })
        break
      }

      case 'full_repair': {
        results.push(...(await diagnoseSystem()))
        results.push(...(await repairDashboard()))
        results.push(...(await repairLogin()))
        results.push(...(await repairCommunication()))
        results.push(...(await restoreUpgrades()))
        break
      }

      default:
        return NextResponse.json({
          ok: false,
          error: `Unknown action: ${action}. Valid: diagnose, repair_dashboard, repair_login, repair_communication, restore_upgrades, verify_integrity, full_repair`,
        }, { status: 400 })
    }

    const hasFail = results.some((r) => r.status === 'fail')
    const hasWarn = results.some((r) => r.status === 'warn')
    const overall = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass'

    return NextResponse.json({
      ok: overall !== 'fail',
      action,
      overall,
      results,
      summary: `${results.length} steps executed. ${results.filter(r => r.status === 'pass').length} pass, ${results.filter(r => r.status === 'warn').length} warn, ${results.filter(r => r.status === 'fail').length} fail.`,
      timestamp: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 })
  }
}

async function diagnoseSystem(): Promise<Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }>> {
  const out: Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

  // 1. DB check
  try {
    await db.user.count()
    out.push({ step: 'db_check', status: 'pass', detail: 'Database responding' })
  } catch (e: any) {
    out.push({ step: 'db_check', status: 'fail', detail: e?.message })
  }

  // 2. Settings check
  try {
    const income = await getIncomeSettings()
    out.push({ step: 'settings_check', status: 'pass', detail: `Income settings OK (goal: $${income.monthlyGoal})` })
  } catch {
    out.push({ step: 'settings_check', status: 'fail', detail: 'Settings not loading' })
  }

  // 3. Custom settings count
  try {
    const custom = await getAllCustomSettings()
    out.push({ step: 'custom_settings_check', status: 'pass', detail: `${Object.keys(custom).length} custom settings` })
  } catch {
    out.push({ step: 'custom_settings_check', status: 'warn', detail: 'Custom settings unavailable' })
  }

  // 4. Subagents check
  try {
    const count = await db.customSubagent.count()
    out.push({ step: 'subagents_check', status: 'pass', detail: `${count} custom subagent overlays` })
  } catch {
    out.push({ step: 'subagents_check', status: 'warn', detail: 'Cannot query subagents' })
  }

  // 5. Upgrade manifest
  const integrity = verifyIntegrity()
  out.push({
    step: 'upgrade_manifest',
    status: integrity.ok ? 'pass' : 'fail',
    detail: `${integrity.total} upgrades registered`,
  })

  return out
}

async function repairDashboard(): Promise<Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }>> {
  const out: Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

  // Ensure income settings exist
  try {
    const income = await getIncomeSettings()
    if (!income.monthlyGoal || income.monthlyGoal < 1) {
      // Reset to default
      const { setIncomeSettings, DEFAULT_INCOME_SETTINGS } = await import('@/lib/settings')
      await setIncomeSettings(DEFAULT_INCOME_SETTINGS)
      out.push({ step: 'repair_income_settings', status: 'pass', detail: 'Income settings restored to default' })
    } else {
      out.push({ step: 'repair_income_settings', status: 'pass', detail: 'Income settings OK' })
    }
  } catch {
    out.push({ step: 'repair_income_settings', status: 'fail', detail: 'Cannot repair income settings' })
  }

  // Ensure notification settings exist
  try {
    const notif = await getNotificationSettings()
    if (!notif) {
      const { setNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } = await import('@/lib/settings')
      await setNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)
      out.push({ step: 'repair_notif_settings', status: 'pass', detail: 'Notification settings restored' })
    } else {
      out.push({ step: 'repair_notif_settings', status: 'pass', detail: 'Notification settings OK' })
    }
  } catch {
    out.push({ step: 'repair_notif_settings', status: 'fail', detail: 'Cannot repair notification settings' })
  }

  // Trigger refresh signal
  try {
    await setCustomSetting('__lastRefresh', { ts: new Date().toISOString(), reason: 'self_heal_dashboard' })
    out.push({ step: 'trigger_refresh', status: 'pass', detail: 'Refresh signal emitted' })
  } catch {
    out.push({ step: 'trigger_refresh', status: 'warn', detail: 'Could not emit refresh signal' })
  }

  return out
}

async function repairLogin(): Promise<Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }>> {
  const out: Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

  // Ensure seed user exists
  try {
    const { ensureSeedUser } = await import('@/lib/auth')
    await ensureSeedUser()
    out.push({ step: 'ensure_seed_user', status: 'pass', detail: 'Seed user verified' })
  } catch (e: any) {
    out.push({ step: 'ensure_seed_user', status: 'fail', detail: e?.message })
  }

  // Check 2FA challenge endpoint
  try {
    const res = await fetch(`http://localhost:${process.env.PORT ?? 3000}/api/2fa/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'antonio.can2022@hotmail.com' }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (res && (res.status === 200 || res.status === 404)) {
      out.push({ step: '2fa_challenge_endpoint', status: 'pass', detail: '2FA challenge endpoint responding' })
    } else {
      out.push({ step: '2fa_challenge_endpoint', status: 'warn', detail: '2FA challenge endpoint not responding' })
    }
  } catch {
    out.push({ step: '2fa_challenge_endpoint', status: 'warn', detail: 'Cannot test 2FA endpoint' })
  }

  return out
}

async function repairCommunication(): Promise<Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }>> {
  const out: Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

  // Check email config
  if (isEmailConfigured()) {
    out.push({ step: 'email_check', status: 'pass', detail: 'SMTP configured' })
  } else {
    out.push({
      step: 'email_check',
      status: 'warn',
      detail: 'SMTP not configured. Set SMTP_HOST/PORT/USER/PASS/FROM env vars.',
    })
  }

  // Check WhatsApp provider config (DB)
  try {
    const userId = (await db.user.findUnique({ where: { email: 'antonio.can2022@hotmail.com' } }))?.id
    if (userId) {
      const pc = await db.phoneConfig.findFirst({ where: { userId } })
      if (pc) {
        out.push({
          step: 'whatsapp_check',
          status: pc.whatsappProvider ? 'pass' : 'warn',
          detail: pc.whatsappProvider ? `Provider: ${pc.whatsappProvider}` : 'No WhatsApp provider set (wa.me always available)',
        })
      } else {
        out.push({ step: 'whatsapp_check', status: 'warn', detail: 'No phone config — wa.me link always available as fallback' })
      }
    } else {
      out.push({ step: 'whatsapp_check', status: 'warn', detail: 'No user — cannot check phone config' })
    }
  } catch {
    out.push({ step: 'whatsapp_check', status: 'warn', detail: 'Cannot check WhatsApp config' })
  }

  return out
}

async function restoreUpgrades(): Promise<Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }>> {
  const out: Array<{ step: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

  // List all upgrades from manifest
  out.push({
    step: 'upgrade_manifest_loaded',
    status: 'pass',
    detail: `${UPGRADE_MANIFEST.length} upgrades in manifest`,
  })

  // Verify integrity
  const integrity = verifyIntegrity()
  out.push({
    step: 'integrity_verified',
    status: integrity.ok ? 'pass' : 'fail',
    detail: `${integrity.total} upgrades verified, ${integrity.missing.length} missing`,
  })

  // List each upgrade
  for (const u of UPGRADE_MANIFEST) {
    out.push({
      step: `upgrade_${u.id}`,
      status: 'pass',
      detail: `${u.title} (${u.category}) — applied ${u.dateApplied}`,
    })
  }

  return out
}
