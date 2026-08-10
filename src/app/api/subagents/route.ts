import { NextRequest, NextResponse } from 'next/server'
import { db, ensureDbReady } from '@/lib/db'
import { getOperatorUserId } from '@/lib/settings'
import { SUBAGENTS, getAllSubagents, FULL_ACCESS_TOOLS, type Subagent } from '@/lib/subagents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Built-in ids — used to reject DELETE on built-in agents. */
const BUILTIN_IDS = new Set(SUBAGENTS.map((s) => s.id))

/* FULL ACCESS: all tools are valid. The owner has granted full access. */
const VALID_TOOLS = new Set(FULL_ACCESS_TOOLS)

/* A curated allow-list of Lucide icon names the client knows how to render.
 * Anything not in this list falls back to the default Sparkles icon. */
const VALID_ICONS = new Set([
  'Sparkles', 'Box', 'TrendingUp', 'Search', 'Crosshair', 'Hammer', 'PenLine', 'Palette',
  'Activity', 'RefreshCw', 'Scale', 'Landmark', 'Bot', 'Brain', 'Zap', 'Globe', 'Database',
  'Terminal', 'Code', 'Cpu', 'Rocket', 'Target', 'DollarSign', 'Briefcase', 'LineChart',
  'PieChart', 'ShieldCheck', 'FileText', 'Lightbulb', 'Cloud', 'Compass', 'Feather',
])

/** GET /api/subagents — list ALL subagents (12 built-in + custom) with overlay edits applied. */
export async function GET() {
  try {
    // Preserve the 37-hour subagent CRUD surface while making the monitor-facing
    // read path resilient to transient database outages.
    await ensureDbReady().catch(() => {})
    let list: Subagent[]
    let degraded = false
    try {
      list = await getAllSubagents({ includeDisabled: true })
    } catch (dbError) {
      degraded = true
      console.warn('[subagents GET] database unavailable; returning built-in agents only', dbError)
      list = SUBAGENTS
    }
    const slim = list.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      specialty: s.specialty,
      color: s.color,
      icon: s.icon,
      allowedTools: s.allowedTools,
      enabled: s.enabled ?? true,
      isBuiltin: s.isBuiltin ?? false,
      systemPromptPreview: s.systemPrompt.slice(0, 200),
    }))
    return NextResponse.json({ subagents: slim, degraded })
  } catch (e: any) {
    console.error('[subagents GET]', e)
    try {
      const slim = SUBAGENTS.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        specialty: s.specialty,
        color: s.color,
        icon: s.icon,
        allowedTools: s.allowedTools,
        enabled: s.enabled ?? true,
        isBuiltin: s.isBuiltin ?? false,
        systemPromptPreview: s.systemPrompt.slice(0, 200),
      }))
      return NextResponse.json({ subagents: slim, degraded: true })
    } catch {
      return NextResponse.json({ error: e?.message ?? 'Failed to list subagents' }, { status: 500 })
    }
  }
}

/** POST /api/subagents — create a new CUSTOM sub-agent. */
export async function POST(req: NextRequest) {
  try {
    await ensureDbReady().catch(() => {})
    const userId = await getOperatorUserId()
    if (!userId) return NextResponse.json({ error: 'No operator user found' }, { status: 500 })

    const body = await req.json().catch(() => ({}))
    const { name, role, specialty, color, icon, allowedTools, systemPrompt, enabled } = body as Partial<Subagent> & { allowedTools?: string[] | string }

    const safeName = (name ?? '').toString().trim().slice(0, 80)
    if (!safeName) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    const safeRole = (role ?? 'Specialist').toString().trim().slice(0, 200) || 'Specialist'
    const safeSpecialty = (specialty ?? '').toString().trim().slice(0, 500)
    const safeColor = validateColor(color) ?? '#00f0ff'
    const safeIcon = VALID_ICONS.has((icon ?? '').toString()) ? (icon as string) : 'Sparkles'
    const toolsArr = parseTools(allowedTools)
    if (toolsArr.length === 0) return NextResponse.json({ error: 'allowedTools must include at least one valid tool name' }, { status: 400 })
    const safePrompt = (systemPrompt ?? '').toString().slice(0, 8000)
    if (safePrompt.length < 20) return NextResponse.json({ error: 'systemPrompt must be at least 20 characters' }, { status: 400 })
    const isEnabled = enabled !== false
    const lowerName = safeName.toLowerCase()
    if (BUILTIN_IDS.has(lowerName)) return NextResponse.json({ error: `Cannot create a custom agent with the reserved name "${safeName}". Use the edit endpoint to modify the built-in.` }, { status: 400 })

    const created = await db.customSubagent.create({
      data: { userId, name: safeName, role: safeRole, specialty: safeSpecialty, color: safeColor, icon: safeIcon, allowedTools: JSON.stringify(toolsArr), systemPrompt: safePrompt, enabled: isEnabled, isBuiltinOverlay: false },
    })
    return NextResponse.json({ ok: true, subagent: created })
  } catch (e: any) {
    console.error('[subagents POST]', e)
    return NextResponse.json({ error: e?.message ?? 'Failed to create subagent' }, { status: 500 })
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
  if (Array.isArray(input)) return input.map((s) => (typeof s === 'string' ? s.trim() : '')).filter((s) => VALID_TOOLS.has(s))
  if (typeof input === 'string') {
    try { const parsed = JSON.parse(input); if (Array.isArray(parsed)) return parseTools(parsed) } catch { /* fall through */ }
    return input.split(',').map((s) => s.trim()).filter((s) => VALID_TOOLS.has(s))
  }
  return []
}
