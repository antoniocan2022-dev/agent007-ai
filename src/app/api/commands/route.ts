import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/commands
 * Execute or reject a pending command.
 * Body: { id: string, action: 'execute' | 'reject' }
 *
 * - 'execute': marks command as 'executing', creates a conversation,
 *   and kicks off the agent run by calling /api/agent internally.
 * - 'reject': marks command as 'rejected'.
 */
export async function POST(req: NextRequest) {
  // Direct DB lookup — works without auth
  const seedUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!seedUser) return NextResponse.json({ error: 'No user found' }, { status: 500 })
  const userId = seedUser.id

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { id, action } = body as { id?: string; action?: string }
  if (!id || !action) {
    return NextResponse.json({ error: 'Missing "id" or "action"' }, { status: 400 })
  }

  const cmd = await db.incomingCommand.findFirst({ where: { id, userId } })
  if (!cmd) {
    return NextResponse.json({ error: 'Command not found' }, { status: 404 })
  }

  if (action === 'reject') {
    await db.incomingCommand.update({
      where: { id },
      data: { status: 'rejected' },
    })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  if (action === 'execute') {
    // Create a conversation for this command
    const conv = await db.conversation.create({
      data: { title: `[${cmd.source}] ${cmd.command.slice(0, 50)}` },
    })

    // Save the command as a user message in the conversation
    await db.message.create({
      data: {
        conversationId: conv.id,
        role: 'user',
        content: `[Command from ${cmd.source}${cmd.fromNumber ? ` (${cmd.fromNumber})` : ''}${cmd.fromEmail ? ` (${cmd.fromEmail})` : ''}]\n\n${cmd.command}`,
      },
    })

    // Mark command as executing
    await db.incomingCommand.update({
      where: { id },
      data: { status: 'executing', conversationId: conv.id, executedAt: new Date() },
    })

    // Kick off the agent run in the background (fire-and-forget)
    // The agent will process the command and respond in the conversation.
    const agentUrl = `http://localhost:3000/api/agent`
    fetch(agentUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: cmd.command,
        conversationId: conv.id,
        attachments: [],
        language: 'en',
      }),
    }).catch(() => {}) // ignore errors — the command is saved + can be retried

    return NextResponse.json({
      ok: true,
      status: 'executing',
      conversationId: conv.id,
      message: 'Command is being executed. Check the conversation for results.',
    })
  }

  return NextResponse.json({ error: `Unknown action: "${action}"` }, { status: 400 })
}

/**
 * DELETE /api/commands?id=<id>
 * Delete a command from the inbox.
 */
export async function DELETE(req: NextRequest) {
  // Direct DB lookup — works without auth
  const seedUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!seedUser) return NextResponse.json({ error: 'No user found' }, { status: 500 })
  const userId = seedUser.id

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing "id"' }, { status: 400 })

  await db.incomingCommand.deleteMany({ where: { id, userId } })
  return NextResponse.json({ ok: true })
}
