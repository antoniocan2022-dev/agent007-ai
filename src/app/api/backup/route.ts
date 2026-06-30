import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const [conversations, memories, incomeEntries, schedules, customSubagents, notificationLogs, userSettings] = await Promise.all([
    db.conversation.findMany({ include: { messages: true } }),
    db.memory.findMany(),
    db.incomeEntry.findMany(),
    db.schedule.findMany(),
    db.customSubagent.findMany(),
    db.notificationLog.findMany(),
    db.userSetting.findMany(),
  ])
  const backup = {
    version: '2.0', exportedAt: new Date().toISOString(), app: 'Agent007 AI',
    data: {
      conversations: conversations.map(c => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages.map(m => ({ id: m.id, role: m.role, content: m.content, toolName: m.toolName, toolArgs: m.toolArgs, toolResult: m.toolResult, attachments: m.attachments, createdAt: m.createdAt })) })),
      memories: memories.map(m => ({ id: m.id, key: m.key, value: m.value, category: m.category, createdAt: m.createdAt, updatedAt: m.updatedAt })),
      incomeEntries: incomeEntries.map(e => ({ id: e.id, amount: e.amount, source: e.source, notes: e.notes, date: e.date, createdAt: e.createdAt })),
      schedules: schedules.map(s => ({ id: s.id, userId: s.userId, name: s.name, prompt: s.prompt, intervalMin: s.intervalMin, enabled: s.enabled, lastRunAt: s.lastRunAt, nextRunAt: s.nextRunAt, lastConvId: s.lastConvId, createdAt: s.createdAt, updatedAt: s.updatedAt })),
      customSubagents: customSubagents.map(s => ({ id: s.id, userId: s.userId, name: s.name, role: s.role, specialty: s.specialty, color: s.color, icon: s.icon, allowedTools: s.allowedTools, systemPrompt: s.systemPrompt, enabled: s.enabled, isBuiltinOverlay: s.isBuiltinOverlay, createdAt: s.createdAt, updatedAt: s.updatedAt })),
      userSettings: userSettings.map(s => ({ id: s.id, userId: s.userId, key: s.key, value: s.value })),
      notificationLogs: notificationLogs.map(n => ({ id: n.id, userId: n.userId, type: n.type, to: n.to, subject: n.subject, body: n.body, sent: n.sent, createdAt: n.createdAt })),
    },
  }
  return new NextResponse(JSON.stringify(backup, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="agent007-backup-${new Date().toISOString().slice(0, 10)}.json"` } })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const data = body?.backup?.data || body?.data
  if (!data) return NextResponse.json({ error: 'Missing "data" field' }, { status: 400 })
  const stats = { conversations: 0, messages: 0, memories: 0, incomeEntries: 0, schedules: 0, customSubagents: 0, userSettings: 0, errors: [] as string[] }
  try {
    if (Array.isArray(data.conversations)) {
      for (const c of data.conversations) {
        try {
          await db.conversation.upsert({ where: { id: c.id }, update: { title: c.title }, create: { id: c.id, title: c.title, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) } })
          stats.conversations++
          if (Array.isArray(c.messages)) {
            for (const m of c.messages) {
              try { await db.message.upsert({ where: { id: m.id }, update: { content: m.content, toolName: m.toolName, toolArgs: m.toolArgs, toolResult: m.toolResult, attachments: m.attachments }, create: { id: m.id, conversationId: c.id, role: m.role, content: m.content, toolName: m.toolName, toolArgs: m.toolArgs, toolResult: m.toolResult, attachments: m.attachments, createdAt: new Date(m.createdAt) } }); stats.messages++ } catch (e: any) { stats.errors.push(`msg ${m.id}: ${e.message}`) }
            }
          }
        } catch (e: any) { stats.errors.push(`conv ${c.id}: ${e.message}`) }
      }
    }
    if (Array.isArray(data.memories)) { for (const m of data.memories) { try { await db.memory.upsert({ where: { key: m.key }, update: { value: m.value, category: m.category }, create: { id: m.id, key: m.key, value: m.value, category: m.category } }); stats.memories++ } catch (e: any) { stats.errors.push(`mem ${m.key}: ${e.message}`) } } }
    if (Array.isArray(data.incomeEntries)) { for (const e of data.incomeEntries) { try { await db.incomeEntry.upsert({ where: { id: e.id }, update: { amount: e.amount, source: e.source, notes: e.notes, date: new Date(e.date) }, create: { id: e.id, amount: e.amount, source: e.source, notes: e.notes, date: new Date(e.date) } }); stats.incomeEntries++ } catch (err: any) { stats.errors.push(`inc ${e.id}: ${err.message}`) } } }
    if (Array.isArray(data.schedules)) { for (const s of data.schedules) { try { await db.schedule.upsert({ where: { id: s.id }, update: { name: s.name, prompt: s.prompt, intervalMin: s.intervalMin, enabled: s.enabled }, create: { id: s.id, userId: s.userId, name: s.name, prompt: s.prompt, intervalMin: s.intervalMin, enabled: s.enabled } }); stats.schedules++ } catch (e: any) { stats.errors.push(`sch ${s.id}: ${e.message}`) } } }
    if (Array.isArray(data.customSubagents)) { for (const s of data.customSubagents) { try { await db.customSubagent.upsert({ where: { id: s.id }, update: { name: s.name, role: s.role, specialty: s.specialty, color: s.color, icon: s.icon, allowedTools: s.allowedTools, systemPrompt: s.systemPrompt, enabled: s.enabled }, create: { id: s.id, userId: s.userId, name: s.name, role: s.role, specialty: s.specialty, color: s.color, icon: s.icon, allowedTools: s.allowedTools, systemPrompt: s.systemPrompt, enabled: s.enabled, isBuiltinOverlay: s.isBuiltinOverlay ?? false } }); stats.customSubagents++ } catch (e: any) { stats.errors.push(`csa ${s.id}: ${e.message}`) } } }
    if (Array.isArray(data.userSettings)) { for (const s of data.userSettings) { try { await db.userSetting.upsert({ where: { userId_key: { userId: s.userId, key: s.key } }, update: { value: s.value }, create: { id: s.id, userId: s.userId, key: s.key, value: s.value } }); stats.userSettings++ } catch (e: any) { stats.errors.push(`set ${s.key}: ${e.message}`) } } }
    return NextResponse.json({ ok: true, message: 'Backup restored', stats })
  } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message ?? 'Restore failed', stats }, { status: 500 }) }
}
