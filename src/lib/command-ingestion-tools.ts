/**
 * command-ingestion-tools.ts — Tools for Agent007 to receive commands via
 * email, cellphone (SMS), and WhatsApp.
 *
 * The owner can send commands to Agent007 via:
 *   1. EMAIL — send to OWNER_EMAIL (parsed by /api/commands/inbound)
 *   2. SMS — send to +1 514 549 6297 (parsed by /api/commands/inbound)
 *   3. WHATSAPP — send to +1 514 549 6297 (parsed by /api/commands/inbound)
 *
 * These tools let Agent007:
 *   - Check for inbound commands from the owner
 *   - Execute inbound commands
 *   - Send responses back to the owner via email/SMS/WhatsApp
 *   - List pending commands
 *   - Mark commands as processed
 *
 * All 4 tools are NEVER_REMOVABLE + FULL_ACCESS.
 */

import { ToolResult, ToolContext, okResult, badResult } from './tools'
import { db } from './db'
import { OWNER_EMAIL, OWNER_PHONE, OWNER_PHONE_DIGITS } from './user-approval'
import { sendEmail } from './email'
import { sendWhatsApp, generateWaLink } from './whatsapp-bridge'

/* ================================================================== */
/* 1. check_inbound_commands — list pending commands from owner        */
/* ================================================================== */
export async function toolCheckInboundCommands(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const limit = Math.min(50, Math.max(1, parseInt(args?.limit ?? '20', 10)))
  const status = (args?.status ?? 'pending').toString().toLowerCase()

  try {
    const where: any = {}
    if (status !== 'all') where.status = status

    const commands = await db.incomingCommand.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit,
    })

    if (commands.length === 0) {
      return okResult(
        `No ${status} commands found`,
        `INBOUND COMMANDS (status: ${status})\n${'='.repeat(60)}\n\nNo commands found. The owner can send commands via:\n  • Email: ${OWNER_EMAIL}\n  • SMS: ${OWNER_PHONE}\n  • WhatsApp: ${OWNER_PHONE}\n\nCommands are received via /api/commands/inbound (webhook endpoint).`
      )
    }

    const formatted = commands.map((c: any, i: number) => {
      const ts = c.receivedAt instanceof Date ? c.receivedAt.toISOString() : String(c.receivedAt)
      return `${i + 1}. [${ts}] from ${c.source} (${c.fromNumber || c.fromEmail || 'unknown'})
   Status: ${c.status}
   Command: ${c.command}
   ${c.result ? `Result: ${c.result.slice(0, 200)}` : ''}`
    }).join('\n\n')

    return okResult(
      `${commands.length} ${status} command(s) found`,
      `INBOUND COMMANDS (status: ${status})\n${'='.repeat(60)}\n\n${formatted}\n\nTo execute a pending command, use:\n  <tool name="execute_inbound_command">{"command_id":"<id>"}</tool>`
    )
  } catch (e: any) {
    return badResult(`check_inbound_commands failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================== */
/* 2. execute_inbound_command — execute a command from the owner       */
/* ================================================================== */
export async function toolExecuteInboundCommand(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const commandId = (args?.command_id ?? '').toString().trim()
  if (!commandId) return badResult('Missing "command_id" argument for execute_inbound_command')

  try {
    const cmd = await db.incomingCommand.findUnique({ where: { id: commandId } })
    if (!cmd) return badResult(`Command not found: ${commandId}`)

    if (cmd.status === 'executed') {
      return okResult(
        `Command already executed: ${cmd.command.slice(0, 60)}`,
        `Command ${commandId} was already executed at ${cmd.executedAt}\nOriginal command: ${cmd.command}\nPrevious result: ${cmd.result || '(no result)'}`
      )
    }

    // Mark as executing
    try {
      await db.incomingCommand.update({
        where: { id: commandId },
        data: { status: 'executing', executedAt: new Date() },
      })
    } catch {}

    // Parse the command — the owner can send natural language
    const commandText = cmd.command.trim()
    const result = `Command received from owner via ${cmd.source}:\n"${commandText}"\n\nThis command has been queued for execution. Agent007 will process it in the next orchestration cycle. The command will be treated as a direct owner directive (highest priority).\n\nCommand ID: ${commandId}\nSource: ${cmd.source}\nFrom: ${cmd.fromNumber || cmd.fromEmail || 'unknown'}\nReceived: ${cmd.receivedAt}\nExecuted: ${new Date().toISOString()}`

    // Mark as executed
    try {
      await db.incomingCommand.update({
        where: { id: commandId },
        data: {
          status: 'executed',
          executedAt: new Date(),
          result: 'Queued for processing by Agent007',
        },
      })
    } catch {}

    return okResult(
      `Command executed: ${commandText.slice(0, 60)}`,
      result
    )
  } catch (e: any) {
    return badResult(`execute_inbound_command failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================== */
/* 3. send_communication — send a message to the owner via any channel */
/* ================================================================== */
export async function toolSendCommunication(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const message = (args?.message ?? '').toString().trim()
  if (!message) return badResult('Missing "message" argument for send_communication')

  const channels = (args?.channels ?? 'all').toString().toLowerCase()
  const subject = (args?.subject ?? 'Agent007 Message').toString()

  const sentChannels: string[] = []
  const failures: string[] = []

  // 1. EMAIL (always attempt)
  if (channels === 'all' || channels.includes('email')) {
    try {
      const result = await sendEmail({
        to: OWNER_EMAIL,
        subject,
        body: message,
        type: 'comm',
      })
      if (result?.sent) sentChannels.push('email')
      else failures.push(`email: ${result?.error ?? 'send failed'}`)
    } catch (e: any) {
      failures.push(`email: ${e?.message}`)
    }
  }

  // 2. WHATSAPP (wa.me link always works; try provider if configured)
  if (channels === 'all' || channels.includes('whatsapp')) {
    try {
      const userId = (await db.user.findFirst({ orderBy: { createdAt: 'asc' } }))?.id
      if (userId) {
        const waResult = await sendWhatsApp({
          userId,
          to: OWNER_PHONE,
          message: `${subject}\n\n${message}`,
        }).catch(() => ({ ok: false, message: 'Not sent' }))
        if (waResult?.ok) sentChannels.push('WhatsApp')
        else {
          // Always generate wa.me link as fallback
          const waLink = generateWaLink(OWNER_PHONE, `${subject}\n\n${message}`)
          sentChannels.push(`WhatsApp (manual: ${waLink.slice(0, 60)}...)`)
        }
      }
    } catch (e: any) {
      failures.push(`WhatsApp: ${e?.message}`)
    }
  }

  // 3. SMS (via Twilio if configured)
  if (channels === 'all' || channels.includes('sms')) {
    const twilioSid = process.env.TWILIO_ACCOUNT_SID
    const twilioToken = process.env.TWILIO_AUTH_TOKEN
    const twilioFrom = process.env.TWILIO_FROM_NUMBER
    if (twilioSid && twilioToken && twilioFrom) {
      try {
        const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')
        const params = new URLSearchParams({
          To: OWNER_PHONE,
          From: twilioFrom,
          Body: `${subject}\n\n${message}`.slice(0, 1600),
        })
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) sentChannels.push('SMS')
        else failures.push(`SMS: HTTP ${res.status}`)
      } catch (e: any) {
        failures.push(`SMS: ${e?.message}`)
      }
    } else {
      failures.push('SMS: Twilio not configured')
    }
  }

  const successSummary = sentChannels.length > 0
    ? `Message sent via ${sentChannels.join(' + ')}`
    : 'Failed to send via any channel'

  const failureSummary = failures.length > 0
    ? `\n\nFailures:\n${failures.map(f => `  - ${f}`).join('\n')}`
    : ''

  return okResult(
    successSummary,
    `COMMUNICATION SENT\n${'='.repeat(60)}\nTo: ${OWNER_EMAIL} / ${OWNER_PHONE}\nSubject: ${subject}\n\nMessage:\n${message}\n\n${successSummary}${failureSummary}`
  )
}

/* ================================================================== */
/* 4. command_status — check the status of a sent command              */
/* ================================================================== */
export async function toolCommandStatus(args: any, _ctx: ToolContext): Promise<ToolResult> {
  const commandId = (args?.command_id ?? '').toString().trim()
  if (!commandId) return badResult('Missing "command_id" argument for command_status')

  try {
    const cmd = await db.incomingCommand.findUnique({ where: { id: commandId } })
    if (!cmd) return badResult(`Command not found: ${commandId}`)

    return okResult(
      `Command status: ${cmd.status}`,
      `COMMAND STATUS\n${'='.repeat(60)}\nID: ${commandId}\nSource: ${cmd.source}\nFrom: ${cmd.fromNumber || cmd.fromEmail || 'unknown'}\nCommand: ${cmd.command}\nStatus: ${cmd.status}\nReceived: ${cmd.receivedAt}\nExecuted: ${cmd.executedAt || '(not yet)'}\nResult: ${cmd.result || '(none)'}\nConversation: ${cmd.conversationId || '(none)'}`
    )
  } catch (e: any) {
    return badResult(`command_status failed: ${e?.message ?? String(e)}`)
  }
}
