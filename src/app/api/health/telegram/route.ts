/**
 * /api/health/telegram — UPGRADE #116
 * Diagnostic + test endpoint for the Telegram integration.
 *
 * GET  /api/health/telegram                — show config state (no secrets)
 * POST /api/health/telegram?action=test    — send a test message to the configured chat
 * POST /api/health/telegram?action=test&chatId=<id>  — send to a custom chat ID
 *
 * No auth required — owner-only via the bot token itself.
 * Returns clear errors explaining exactly what's wrong.
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function mask(key: string | undefined): string {
  if (!key) return '(NOT SET)'
  if (key.length <= 12) return `(SET, len=${key.length})`
  return `${key.slice(0, 6)}…${key.slice(-4)} (len=${key.length})`
}

export async function GET(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  const diagnostics = {
    ok: true,
    timestamp: new Date().toISOString(),
    runtime: process.env.VERCEL ? 'vercel-serverless' : 'local',
    region: process.env.VERCEL_REGION || 'unknown',
    config: {
      TELEGRAM_BOT_TOKEN: mask(token),
      TELEGRAM_CHAT_ID: mask(chatId),
      tokenFormat: token ? (token.includes(':') ? 'VALID (contains colon)' : 'INVALID (no colon — must be <id>:<hash>)') : 'MISSING',
      tokenLength: token ? token.length : 0,
      chatIdFormat: chatId ? (Number(chatId) ? 'VALID (numeric)' : 'INVALID (must be numeric)') : 'MISSING',
    },
    setup: {
      step1: 'Open Telegram, search @BotFather, send /newbot → get BOT_TOKEN (format: 123456:ABCdef...)',
      step2: 'Open your new bot, tap Start, send any message → get CHAT_ID via https://api.telegram.org/bot<TOKEN>/getUpdates',
      step3: 'Add TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars in Vercel',
      step4: 'Redeploy (Deployments → most recent → ⋯ → Redeploy)',
      step5: 'Visit /api/health/telegram?action=test (POST) to send a test message',
    },
    testEndpoints: {
      getState: 'GET /api/health/telegram',
      sendTest: 'POST /api/health/telegram?action=test',
      sendTestCustom: 'POST /api/health/telegram?action=test&chatId=<your_chat_id>',
    },
  }

  return NextResponse.json(diagnostics)
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'test'
  if (action !== 'test') {
    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 })
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  const defaultChatId = process.env.TELEGRAM_CHAT_ID
  const customChatId = url.searchParams.get('chatId')
  const body = await req.json().catch(() => ({}))
  const customMessage = body.message

  const targetChatId = customChatId || defaultChatId

  // Step 1: validate env vars
  if (!token) {
    return NextResponse.json({
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN is NOT SET in Vercel env vars.',
      config: { TELEGRAM_BOT_TOKEN: mask(token), TELEGRAM_CHAT_ID: mask(defaultChatId) },
      fix: 'Add TELEGRAM_BOT_TOKEN to Vercel → Settings → Environment Variables → Production + Preview → Redeploy',
    }, { status: 400 })
  }

  if (!targetChatId) {
    return NextResponse.json({
      ok: false,
      error: 'TELEGRAM_CHAT_ID is NOT SET and no chatId query param provided.',
      config: { TELEGRAM_BOT_TOKEN: mask(token), TELEGRAM_CHAT_ID: mask(defaultChatId) },
      fix: 'Add TELEGRAM_CHAT_ID to Vercel → Settings → Environment Variables → Production + Preview → Redeploy. OR pass ?chatId=<id> in the URL.',
    }, { status: 400 })
  }

  // Step 2: verify the bot exists by calling /getMe
  try {
    const meResp = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10000),
    })
    const meData = await meResp.json().catch(() => ({}))

    if (!meResp.ok || !meData.ok) {
      return NextResponse.json({
        ok: false,
        error: `Bot token is invalid or Telegram API rejected it.`,
        telegramResponse: meData,
        config: { TELEGRAM_BOT_TOKEN: mask(token), TELEGRAM_CHAT_ID: mask(targetChatId) },
        fix: meData?.description?.includes('Not Found')
          ? 'Bot token is invalid. Get a fresh one from @BotFather → /newbot or /token'
          : 'Check the bot token format. Should be like 1234567890:ABCdefGhiJKLmNoPQRstuVWXyz',
      }, { status: 400 })
    }

    const botInfo = meData.result

    // Step 3: send the test message
    // UPGRADE #116 FIX — Send as PLAIN TEXT (no parse_mode).
    // Telegram's Markdown parser is strict and breaks on unmatched _, *, [, ].
    // The bot username @xxx and emoji caused "can't parse entities" errors.
    const message = customMessage || `Agent007 Telegram Test\n\nBot is working!\nBot: @${botInfo.username}\nChat ID: ${targetChatId}\nTime: ${new Date().toISOString()}\n\nIf you received this message, your Telegram integration is fully configured.`

    const sendResp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        disable_web_page_preview: true,
        // NO parse_mode — plain text. Safe for any content.
      }),
      signal: AbortSignal.timeout(15000),
    })

    const sendData = await sendResp.json().catch(() => ({}))

    if (!sendResp.ok || !sendData.ok) {
      return NextResponse.json({
        ok: false,
        error: `Bot is valid but message delivery FAILED.`,
        botInfo,
        targetChatId,
        telegramResponse: sendData,
        commonCauses: {
          'chat not found': 'You never started a conversation with the bot. Open @<bot_username> in Telegram, tap Start, send any message, then retry.',
          'Forbidden: bot was blocked by the user': 'You blocked the bot. Unblock it in Telegram and retry.',
          'Forbidden: chat not found': 'The CHAT_ID is wrong. Get the correct one from https://api.telegram.org/bot<TOKEN>/getUpdates after sending a message to the bot.',
          'Bad Request: chat not found': 'The CHAT_ID is invalid or the bot has never seen this chat. Send /start to the bot first.',
        },
        fix: sendData?.description
          ? `Telegram says: "${sendData.description}". See commonCauses above.`
          : 'Check the Telegram response above for the specific error.',
      }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      message: 'Telegram test message sent successfully! Check your Telegram app.',
      botInfo,
      targetChatId,
      sentMessage: message,
      telegramMessageId: sendData?.result?.message_id,
      sentAt: new Date().toISOString(),
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: `Network error reaching Telegram API: ${e?.message}`,
      config: { TELEGRAM_BOT_TOKEN: mask(token), TELEGRAM_CHAT_ID: mask(targetChatId) },
      fix: 'Could be a transient network issue or Telegram API is unreachable from this region. Try again in 30s.',
    }, { status: 500 })
  }
}
