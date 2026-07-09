import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/commands/poll-email
 *
 * Polls the owner's email inbox via IMAP for new messages and saves them
 * as commands. NO third-party service needed — just IMAP (which every
 * email provider supports: Outlook, Gmail, Yahoo, etc.).
 */
export async function POST() {
  const seedUser = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!seedUser) return NextResponse.json({ error: 'No user' }, { status: 500 })

  const config = await db.phoneConfig.findFirst({ where: { userId: seedUser.id } })
  if (!config || !config.emailEnabled || !config.emailImapHost || !config.emailImapUser) {
    return NextResponse.json({
      ok: false,
      message: 'Email IMAP not configured. Go to Settings → COMMAND CHANNELS to set up email.',
      newCommands: 0,
    })
  }

  try {
    let ImapFlow
    try {
      ImapFlow = (await import('imapflow')).ImapFlow
    } catch {
      const { execSync } = await import('child_process')
      try {
        execSync('bun add imapflow', { cwd: '/home/z/my-project', stdio: 'pipe', timeout: 30000 })
        ImapFlow = (await import('imapflow')).ImapFlow
      } catch {
        return NextResponse.json({ ok: false, message: 'imapflow not installed. Run: bun add imapflow', newCommands: 0 })
      }
    }

    const client = new ImapFlow({
      host: config.emailImapHost,
      port: parseInt(config.emailImapPort || '993'),
      secure: true,
      auth: { user: config.emailImapUser, pass: config.emailImapPassword },
      logger: false,
    })

    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    let newCommands = 0

    try {
      const uids = await client.search({ seen: false })
      for (const uid of uids.slice(0, 10)) {
        const msg = await client.fetchOne(uid, { source: true, envelope: true })
        if (!msg) continue
        const from = msg.envelope?.from?.[0]
        const fromEmail = from ? `${from.address}` : 'unknown'
        const subject = msg.envelope?.subject || '(no subject)'
        const rawEmail = msg.source?.toString('utf-8') || ''
        const bodyText = extractTextFromEmail(rawEmail)
        const command = bodyText.trim() || subject.trim()
        if (!command || command.length < 3) continue
        await db.incomingCommand.create({
          data: { userId: seedUser.id, source: 'email', fromEmail, command: command.slice(0, 5000), status: 'pending' },
        })
        newCommands++
        await client.messageFlagsAdd(uid, ['\\Seen'])
      }
    } finally {
      lock.release()
    }
    await client.logout()
    return NextResponse.json({ ok: true, newCommands, message: newCommands > 0 ? `${newCommands} new email command(s)!` : 'No new emails.' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, message: `IMAP failed: ${e?.message ?? 'error'}`, newCommands: 0 })
  }
}

function extractTextFromEmail(raw: string): string {
  const headerEnd = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n')
  if (headerEnd < 0) return raw.slice(0, 5000)
  const body = raw.slice(headerEnd + 4)
  const isHTML = /content-type:\s*text\/html/i.test(raw.slice(0, headerEnd))
  let text = body
  if (isHTML) {
    text = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  } else {
    text = text.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).trim()
  }
  text = text.split(/\nOn .* wrote:/)[0].trim()
  return text.slice(0, 5000)
}
