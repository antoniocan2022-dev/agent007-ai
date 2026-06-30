import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'
import { SUBAGENTS } from '@/lib/subagents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUILTIN_IDS = new Set(SUBAGENTS.map((s) => s.id))

const VALID_TOOLS = new Set([
  'web_search',
  'page_reader',
  'image_gen',
  'vision',
  'code_exec',
  'memory_store',
  'memory_recall',
  'file_read',
  'wikipedia_search',
  'wikipedia_read',
  'free_apis_directory',
])

const VALID_ICONS = new Set([
  'Sparkles',
  'Box',
  'TrendingUp',
  'Search',
  'Crosshair',
  'Hammer',
  'PenLine',
  'Palette',
  'Activity',
  'RefreshCw',
  'Scale',
  'Landmark',
  'Bot',
  'Brain',
  'Zap',
  'Globe',
  'Database',
  'Terminal',
  'Code',
  'Cpu',
  'Rocket',
  'Target',
  'DollarSign',
  'Briefcase',
  'LineChart',
  'PieChart',
  'ShieldCheck',
  'FileText',
  'Lightbulb',
  'Cloud',
  'Compass',
  'Feather',
])

/** GET /api/subagents/[id] — fetch a single subagent (built-in or custom),
 *  including the FULL systemPrompt (used by the edit modal). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Built-in?
    const builtin = SUBAGENTS.find((s) => s.id === id)
    const userId = await getOperatorUserId()
    let overlay: any = null
    if (userId) {
      overlay = await db.customSubagent.findFirst({
        where: { userId, id, isBuiltinOverlay: true },
      })
    }
    if (builtin) {
      const merged = {
        id: builtin.id,
        name: overlay?.name ?? builtin.name,
        role: overlay?.role ?? builtin.role,
        specialty: overlay?.specialty ?? builtin.specialty,
        color: overlay?.color ?? builtin.color,
        icon: overlay?.icon ?? builtin.icon,
        allowedTools: overlay?.allowedTools ? parseTools(overlay.allowedTools) : builtin.allowedTools,
        systemPrompt: overlay?.systemPrompt ?? builtin.systemPrompt,
        enabled: overlay?.enabled ?? builtin.enabled ?? true,
        isBuiltin: true,
        hasOverlay: !!overlay,
      }
      return NextResponse.json({ subagent: merged })
    }
    // Custom?
    if (!userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const custom = await db.customSubagent.findFirst({
      where: { userId, id, isBuiltinOverlay: false },
    })
    if (!custom) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      subagent: {
        id: custom.id,
        name: custom.name,
        role: custom.role,
        specialty: custom.specialty,
        color: custom.color,
        icon: custom.icon,
        allowedTools: parseTools(custom.allowedTools),
        systemPrompt: custom.systemPrompt,
        enabled: custom.enabled,
        isBuiltin: false,
        hasOverlay: false,
      },
    })
  } catch (e: any) {
    console.error('[subagent GET]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to fetch subagent' }, { status: 500 })
  }
}

/** PUT /api/subagents/[id] — edit a subagent (built-in via overlay OR custom).
 *  Accepts any subset of fields. For built-in agents, creates or updates an
 *  overlay row in CustomSubagent (isBuiltinOverlay=true). For custom agents,
 *  edits the row in place. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ error: 'No operator user found' }, { status: 500 })

    const body = await req.json().catch(() => ({}))
    const update: any = {}
    if (typeof body.name === 'string') update.name = body.name.trim().slice(0, 80)
    if (typeof body.role === 'string') update.role = body.role.trim().slice(0, 200)
    if (typeof body.specialty === 'string') update.specialty = body.specialty.trim().slice(0, 500)
    if (typeof body.color === 'string') {
      const c = validateColor(body.color)
      if (c) update.color = c
    }
    if (typeof body.icon === 'string' && VALID_ICONS.has(body.icon)) update.icon = body.icon
    if (body.allowedTools !== undefined) {
      const tools = parseTools(body.allowedTools)
      if (tools.length > 0) update.allowedTools = JSON.stringify(tools)
    }
    if (typeof body.systemPrompt === 'string') {
      if (body.systemPrompt.length < 20) {
        return NextResponse.json(
          { error: 'systemPrompt must be at least 20 characters' },
          { status: 400 }
        )
      }
      update.systemPrompt = body.systemPrompt.slice(0, 8000)
    }
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const isBuiltin = BUILTIN_IDS.has(id)
    if (isBuiltin) {
      // Upsert an overlay row
      const existing = await db.customSubagent.findFirst({
        where: { userId, id, isBuiltinOverlay: true },
      })
      if (existing) {
        const updated = await db.customSubagent.update({
          where: { id: existing.id },
          data: update,
        })
        return NextResponse.json({ ok: true, subagent: updated })
      } else {
        // Create overlay — need to copy built-in defaults to satisfy NOT NULL constraints
        const builtin = SUBAGENTS.find((s) => s.id === id)!
        const created = await db.customSubagent.create({
          data: {
            id: builtin.id,
            userId,
            name: update.name ?? builtin.name,
            role: update.role ?? builtin.role,
            specialty: update.specialty ?? builtin.specialty,
            color: update.color ?? builtin.color,
            icon: update.icon ?? builtin.icon,
            allowedTools: update.allowedTools ?? JSON.stringify(builtin.allowedTools),
            systemPrompt: update.systemPrompt ?? builtin.systemPrompt,
            enabled: update.enabled ?? true,
            isBuiltinOverlay: true,
          },
        })
        return NextResponse.json({ ok: true, subagent: created })
      }
    } else {
      // Custom — update in place (must belong to this user)
      const existing = await db.customSubagent.findFirst({
        where: { userId, id, isBuiltinOverlay: false },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Custom subagent not found' }, { status: 404 })
      }
      const updated = await db.customSubagent.update({
        where: { id: existing.id },
        data: update,
      })
      return NextResponse.json({ ok: true, subagent: updated })
    }
  } catch (e: any) {
    console.error('[subagent PUT]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to update subagent' }, { status: 500 })
  }
}

/** DELETE /api/subagents/[id] — delete a CUSTOM subagent only.
 *  Built-in agents cannot be deleted (returns 403). To "remove" a built-in,
 *  the user should disable it via PUT {enabled:false} (or the toggle UI). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ error: 'No operator user found' }, { status: 500 })

    if (BUILTIN_IDS.has(id)) {
      // Built-in — check if there's an overlay to delete (essentially "reset to default")
      const overlay = await db.customSubagent.findFirst({
        where: { userId, id, isBuiltinOverlay: true },
      })
      if (overlay) {
        await db.customSubagent.delete({ where: { id: overlay.id } })
        return NextResponse.json({
          ok: true,
          message: 'Overlay deleted; built-in agent reset to defaults.',
        })
      }
      return NextResponse.json(
        {
          error:
            'Built-in agents cannot be deleted. Disable them via the toggle, or use DELETE to remove any overlay edits (resetting to defaults).',
        },
        { status: 403 }
      )
    }

    // Custom — delete the row
    const existing = await db.customSubagent.findFirst({
      where: { userId, id, isBuiltinOverlay: false },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Custom subagent not found' }, { status: 404 })
    }
    await db.customSubagent.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true, message: 'Custom subagent deleted.' })
  } catch (e: any) {
    console.error('[subagent DELETE]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to delete subagent' }, { status: 500 })
  }
}

/* ----------------------------- helpers -------------------------------- */

function validateColor(c?: string): string | null {
  if (!c || typeof c !== 'string') return null
  const trimmed = c.trim()
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed
  return null
}

function parseTools(input: any): string[] {
  if (!input) return []
  if (Array.isArray(input)) {
    return input
      .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
      .filter((s: string) => VALID_TOOLS.has(s))
  }
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) return parseTools(parsed)
    } catch {
      /* fall through */
    }
    return input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => VALID_TOOLS.has(s))
  }
  return []
}
