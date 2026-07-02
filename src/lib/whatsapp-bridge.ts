/**
 * whatsapp-bridge.ts — FREE personal WhatsApp integration.
 * 3 options: Baileys (two-way QR), CallMeBot (one-way), wa.me (click-to-chat)
 */
import { db } from '@/lib/db'

export function normalizePhone(input: string): string {
  return input.replace(/[^\d]/g, '')
}

export function generateWaLink(to: string, message: string): string {
  const phone = normalizePhone(to)
  const text = encodeURIComponent(message)
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`
}

export async function sendViaCallmebot(opts: { phone: string; apiKey: string; message: string }) {
  const phone = normalizePhone(opts.phone)
  if (!phone || !opts.apiKey || !opts.message) return { ok: false, message: 'Missing params' }
  const params = new URLSearchParams({ phone, apikey: opts.apiKey, text: opts.message })
  try {
    const res = await fetch(`https://api.callmebot.com/whatsapp.php?${params}`, { signal: AbortSignal.timeout(15000) })
    const text = await res.text()
    if (res.ok && (text.includes('queued') || text.includes('sent'))) return { ok: true, message: '✅ Sent via CallMeBot' }
    return { ok: false, message: `CallMeBot error: ${text.slice(0, 200)}` }
  } catch (e: any) { return { ok: false, message: `CallMeBot failed: ${e?.message}` } }
}

interface BaileysSession { socket: any; qrCode: string | null; status: string; linkedNumber: string | null; userId: string; lastError: string | null }
const _g: any = globalThis as any
if (!_g.__baileysSessions) _g.__baileysSessions = new Map<string, BaileysSession>()
const _sessions: Map<string, BaileysSession> = _g.__baileysSessions

export async function startBaileysSession(opts: { userId: string; forceFresh?: boolean }) {
  const { userId, forceFresh = false } = opts
  const existing = _sessions.get(userId)
  if (existing && existing.status === 'linked') return { ok: true, message: `WhatsApp linked to ${existing.linkedNumber}` }
  if (existing && existing.status === 'pending' && existing.qrCode && !forceFresh) return { ok: true, qrCode: existing.qrCode, message: 'QR already generated' }
  if (existing?.socket) { try { await existing.socket.end?.() } catch {} }
  _sessions.delete(userId)
  if (forceFresh) { try { await import('node:fs').then(f => f.promises.rm(`/tmp/baileys-auth-${userId}`, { recursive: true, force: true })) } catch {} }

  const session: BaileysSession = { socket: null, qrCode: null, status: 'pending', linkedNumber: null, userId, lastError: null }
  _sessions.set(userId, session)

  try {
    const lib: any = await import('@whiskeysockets/baileys')
    const makeWASocket = lib.default || lib.makeWASocket
    const useMultiFileAuthState = lib.useMultiFileAuthState
    const fetchLatestBaileysVersion = lib.fetchLatestBaileysVersion
    if (!makeWASocket) return { ok: false, message: 'Baileys not loaded' }

    const initAuthState = useMultiFileAuthState
    const { state, saveCreds } = await initAuthState(`/tmp/baileys-auth-${userId}`)
    const { version } = await fetchLatestBaileysVersion()
    const socket = makeWASocket({ auth: state, version, printQRInTerminal: false, connectTimeoutMs: 60000, browser: ['Mac OS', 'Chrome', '14.4.1'] })
    session.socket = socket
    const QRCode = (await import('qrcode')).default

    socket.ev.on('connection.update', async (update: any) => {
      const { connection, qr, lastDisconnect } = update
      if (qr) { try { session.qrCode = await QRCode.toDataURL(qr, { width: 256, margin: 1 }) } catch {} }
      if (connection === 'open') {
        session.status = 'linked'
        session.linkedNumber = socket.user?.id?.split(':')[0]?.replace('@s.whatsapp.net', '') ?? null
        session.qrCode = null
        await saveCreds()
        try { const pc = await db.phoneConfig.findFirst({ where: { userId } }); if (pc) await db.phoneConfig.update({ where: { id: pc.id }, data: { whatsappProvider: 'baileys', baileysSessionStatus: 'linked', baileysLinkedNumber: session.linkedNumber, baileysLinkedAt: new Date(), whatsappEnabled: true, whatsappNumber: session.linkedNumber } }) } catch {}
      }
      if (connection === 'close') {
        const sc = lastDisconnect?.error?.output?.statusCode
        if (sc === 410) { session.status = 'disconnected'; _sessions.delete(userId) }
        else if (sc === 515 || sc === 428 || sc === 401 || sc === 400) { session.status = 'pending'; setTimeout(() => startBaileysSession({ userId }).catch(() => {}), 3000) }
        else { session.status = 'error'; session.lastError = `code ${sc}` }
      }
    })
    socket.ev.on('creds.update', saveCreds)

    // Wait up to 12s for QR
    const deadline = Date.now() + 12000
    while (Date.now() < deadline) { if (session.qrCode || session.status === 'linked') break; await new Promise(r => setTimeout(r, 500)) }
    if (session.qrCode) return { ok: true, qrCode: session.qrCode, message: 'QR generated. Scan with WhatsApp → Linked Devices.' }
    if (session.status === 'linked') return { ok: true, message: `WhatsApp linked to ${session.linkedNumber}` }
    return { ok: true, message: 'Session starting. Poll /qr.' }
  } catch (e: any) { session.status = 'error'; session.lastError = e?.message; return { ok: false, message: `Baileys failed: ${e?.message}` } }
}

export function getBaileysQrCode(userId: string) { return _sessions.get(userId)?.qrCode ?? null }
export function getBaileysStatus(userId: string) { const s = _sessions.get(userId); return s ? { status: s.status, linkedNumber: s.linkedNumber, qrCode: s.qrCode, lastError: s.lastError } : { status: 'disconnected', linkedNumber: null, qrCode: null, lastError: null } }

export async function disconnectBaileys(userId: string) {
  const s = _sessions.get(userId); if (!s) return { ok: true, message: 'No session' }
  try { await s.socket?.logout?.() } catch {}
  _sessions.delete(userId)
  return { ok: true, message: 'WhatsApp disconnected' }
}

export async function sendViaBaileys(opts: { userId: string; to: string; message: string }) {
  const s = _sessions.get(opts.userId)
  if (!s || s.status !== 'linked') return { ok: false, message: 'WhatsApp not linked. Scan QR first.' }
  try { await s.socket.sendMessage(normalizePhone(opts.to) + '@s.whatsapp.net', { text: opts.message }); return { ok: true, message: '✅ Sent via Baileys' } }
  catch (e: any) { return { ok: false, message: `Baileys send failed: ${e?.message}` } }
}

export async function sendWhatsApp(opts: { userId: string; to?: string; message: string }) {
  const pc = await db.phoneConfig.findFirst({ where: { userId: opts.userId } })
  if (!pc) return { ok: false, message: 'No phone config' }
  const provider = pc.whatsappProvider ?? 'none'
  if (provider === 'callmebot') return sendViaCallmebot({ phone: opts.to ?? pc.callmebotNumber ?? '', apiKey: pc.callmebotApiKey ?? '', message: opts.message })
  if (provider === 'baileys') { if (!opts.to) return { ok: false, message: 'Baileys requires recipient' }; return sendViaBaileys({ userId: opts.userId, to: opts.to, message: opts.message }) }
  if (provider === 'wa_link') return { ok: true, message: `wa.me link: ${generateWaLink(opts.to ?? pc.whatsappNumber ?? '', opts.message)}` }
  return { ok: false, message: `Unknown provider: ${provider}` }
}
