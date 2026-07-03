import { NextRequest, NextResponse } from 'next/server'
import { getAllCustomSettings, setCustomSetting } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/dashboard/widgets — manage custom dashboard widgets.
 *
 * GET  → returns all custom widgets
 * POST → { action: 'add' | 'edit' | 'remove' | 'clear', id?, widget? }
 *        - add/edit: widget = { id, title, type, value, color?, icon?, position? }
 *        - remove: id
 *        - clear: remove all custom widgets
 *
 * Widget types: 'kpi' | 'stat' | 'note' | 'link' | 'progress' | 'alert'
 * Position: 'top' | 'middle' | 'bottom' (default: 'top')
 */

interface CustomWidget {
  id: string
  title: string
  type: 'kpi' | 'stat' | 'note' | 'link' | 'progress' | 'alert'
  value: string | number
  subtitle?: string
  color?: string
  icon?: string
  position?: 'top' | 'middle' | 'bottom'
  link?: string
  alertLevel?: 'info' | 'warn' | 'error'
  progress?: number // 0-100 for 'progress' type
  updatedAt: string
}

const WIDGETS_KEY = 'dashboard_custom_widgets'

export async function GET() {
  const custom = (await getAllCustomSettings().catch(() => ({}))) as Record<string, any>
  const widgets: CustomWidget[] = (custom[WIDGETS_KEY] as CustomWidget[] | undefined) ?? []
  return NextResponse.json({
    widgets,
    count: widgets.length,
    timestamp: new Date().toISOString(),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const action = (body.action as string | undefined) ?? 'add'
    const custom = await getAllCustomSettings().catch(() => ({}))
    const widgets: CustomWidget[] = (custom[WIDGETS_KEY] as CustomWidget[] | undefined) ?? []

    if (action === 'clear') {
      await setCustomSetting(WIDGETS_KEY, [])
      return NextResponse.json({ ok: true, message: 'All custom widgets cleared.', widgets: [] })
    }

    if (action === 'remove') {
      const id = (body.id as string | undefined)?.toString().trim()
      if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
      const filtered = widgets.filter((w) => w.id !== id)
      await setCustomSetting(WIDGETS_KEY, filtered)
      return NextResponse.json({
        ok: true,
        message: `Widget "${id}" removed.`,
        widgets: filtered,
      })
    }

    // add or edit
    const w = body.widget as Partial<CustomWidget> | undefined
    if (!w) return NextResponse.json({ ok: false, error: 'widget required' }, { status: 400 })
    const id = (w.id ?? '').toString().trim()
    if (!id) return NextResponse.json({ ok: false, error: 'widget.id required' }, { status: 400 })
    if (!w.title || typeof w.title !== 'string') {
      return NextResponse.json({ ok: false, error: 'widget.title required' }, { status: 400 })
    }
    const validTypes: CustomWidget['type'][] = ['kpi', 'stat', 'note', 'link', 'progress', 'alert']
    const type = ((w.type ?? 'kpi').toString() as CustomWidget['type'])
    if (!validTypes.includes(type)) {
      return NextResponse.json({ ok: false, error: `Invalid type. Valid: ${validTypes.join(', ')}` }, { status: 400 })
    }
    const validPositions: CustomWidget['position'][] = ['top', 'middle', 'bottom']
    const position = ((w.position ?? 'top').toString() as CustomWidget['position'])
    if (!validPositions.includes(position)) {
      return NextResponse.json({ ok: false, error: `Invalid position. Valid: ${validPositions.join(', ')}` }, { status: 400 })
    }

    const widget: CustomWidget = {
      id,
      title: (w.title as string).slice(0, 100),
      type,
      value: w.value ?? '',
      subtitle: w.subtitle?.toString().slice(0, 200) ?? undefined,
      color: w.color?.toString().slice(0, 20) ?? undefined,
      icon: w.icon?.toString().slice(0, 40) ?? undefined,
      position,
      link: w.link?.toString().slice(0, 500) ?? undefined,
      alertLevel: (w.alertLevel as CustomWidget['alertLevel']) ?? undefined,
      progress: typeof w.progress === 'number' ? Math.max(0, Math.min(100, w.progress)) : undefined,
      updatedAt: new Date().toISOString(),
    }

    const existingIdx = widgets.findIndex((x) => x.id === id)
    if (existingIdx >= 0) {
      widgets[existingIdx] = widget
    } else {
      widgets.push(widget)
    }
    await setCustomSetting(WIDGETS_KEY, widgets)
    return NextResponse.json({
      ok: true,
      message: existingIdx >= 0 ? `Widget "${id}" updated.` : `Widget "${id}" added.`,
      widget,
      widgets,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    )
  }
}
