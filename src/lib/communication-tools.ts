/**
 * communication-tools.ts — UPGRADE #103
 * 3 FREE reliable communication channels that work on Vercel serverless.
 * Replaces broken Baileys/CallMeBot/Twilio integrations.
 *
 * 1. telegram_notify — Telegram Bot API (free, two-way, reliable)
 * 2. ntfy_notify — ntfy.sh push notifications (free, no signup, instant)
 * 3. discord_notify — Discord webhook (free, rich embeds, multi-channel)
 */
import type { ToolResult } from './tools'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function fail(r: string): ToolResult { return { ok: false, preview: r.slice(0, 120), result: r } }

/* ═══ 1. TELEGRAM BOT NOTIFY ═══ */

export async function toolTelegramNotify(args: any): Promise<ToolResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const defaultChatId = process.env.TELEGRAM_CHAT_ID
  // UPGRADE #116 FIX — Default parse_mode changed from 'Markdown' to '' (plain text).
  // Telegram's Markdown parser is strict and breaks on any unmatched _, *, [, ], etc.
  // which caused EVERY agent message containing those chars to fail silently.
  // Now defaults to plain text (no parsing). Pass parseMode='HTML' or 'MarkdownV2' explicitly
  // when you want formatting.
  const { message, chatId, parseMode = '' } = args ?? {}

  if (!message) return fail('telegram_notify requires "message"')

  if (!token) {
    return fail(`Telegram requires TELEGRAM_BOT_TOKEN env var. Setup:
1. Open Telegram, search @BotFather
2. Send /newbot → get BOT_TOKEN
3. Send /start to your new bot → get CHAT_ID
4. Set env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
5. Redeploy

The bot will send push notifications to your phone instantly.`)
  }

  const targetChatId = chatId || defaultChatId
  if (!targetChatId) return fail('telegram_notify requires "chatId" or TELEGRAM_CHAT_ID env var')

  try {
    // UPGRADE #116: Build the request body conditionally — only include
    // parse_mode if it's explicitly set. Empty string means "plain text".
    const body: any = {
      chat_id: targetChatId,
      text: message,
      disable_web_page_preview: true,
    }
    if (parseMode && parseMode !== 'plain' && parseMode !== 'text') {
      body.parse_mode = parseMode
    }

    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return fail(`Telegram: HTTP ${resp.status} — ${text.slice(0, 200)}`)
    }

    const data = await resp.json()
    if (data.ok) {
      return ok(`✅ Sent to Telegram chat ${targetChatId}`, `Telegram notification sent successfully.\nMessage: ${message.slice(0, 200)}\n\nDelivered to chat ID: ${targetChatId}`)
    }
    return fail(`Telegram API error: ${JSON.stringify(data).slice(0, 200)}`)
  } catch (e: any) {
    return fail(`Telegram: ${e?.message}`)
  }
}

/* ═══ 2. NTFY.SH PUSH NOTIFY ═══ */

export async function toolNtfyNotify(args: any): Promise<ToolResult> {
  const { message, topic, title, priority = 3, tags } = args ?? {}

  if (!message) return fail('ntfy_notify requires "message"')

  // Default topic from env or use a hardcoded default
  const defaultTopic = process.env.NTFY_TOPIC || 'agent007-antonio-notifications'
  const targetTopic = topic || defaultTopic

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
    }
    if (title) headers['Title'] = title
    if (priority) headers['Priority'] = String(priority)
    if (tags) headers['Tags'] = tags

    const resp = await fetch(`https://ntfy.sh/${targetTopic}`, {
      method: 'POST',
      headers,
      body: message,
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return fail(`ntfy.sh: HTTP ${resp.status} — ${text.slice(0, 200)}`)
    }

    return ok(
      `✅ Sent to ntfy topic: ${targetTopic}`,
      `ntfy.sh push notification sent successfully.\nTopic: ${targetTopic}\nMessage: ${message.slice(0, 200)}\n\nTo receive on your phone:\n1. Install ntfy app (iOS/Android)\n2. Subscribe to topic: ${targetTopic}\n3. Push notification will appear instantly`
    )
  } catch (e: any) {
    return fail(`ntfy.sh: ${e?.message}`)
  }
}

/* ═══ 3. DISCORD WEBHOOK NOTIFY ═══ */

export async function toolDiscordNotify(args: any): Promise<ToolResult> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  const { message, title, color = 0x00f0ff, fields } = args ?? {}

  if (!message && !title) return fail('discord_notify requires "message" or "title"')

  if (!webhookUrl) {
    return fail(`Discord requires DISCORD_WEBHOOK_URL env var. Setup:
1. Create a Discord server (free)
2. Create a channel like #agent007-alerts
3. Channel Settings → Integrations → Webhooks → New Webhook
4. Copy webhook URL
5. Set env var: DISCORD_WEBHOOK_URL
6. Redeploy`)
  }

  try {
    const body: any = {
      content: message || undefined,
    }

    // If title or fields provided, send as rich embed
    if (title || fields) {
      body.embeds = [{
        title: title || 'Agent007 Notification',
        description: message || '',
        color: color,
        timestamp: new Date().toISOString(),
        footer: { text: 'Agent007 AI' },
      }]
      if (fields && Array.isArray(fields)) {
        body.embeds[0].fields = fields.map((f: any) => ({
          name: f.name || 'Field',
          value: f.value || '',
          inline: f.inline ?? false,
        }))
      }
      body.content = undefined // Use embed only
    }

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      return fail(`Discord: HTTP ${resp.status} — ${text.slice(0, 200)}`)
    }

    return ok(
      `✅ Sent to Discord webhook`,
      `Discord notification sent successfully.\n${title ? `Title: ${title}\n` : ''}Message: ${message.slice(0, 200)}\n\nDelivered to Discord channel via webhook.`
    )
  } catch (e: any) {
    return fail(`Discord: ${e?.message}`)
  }
}
