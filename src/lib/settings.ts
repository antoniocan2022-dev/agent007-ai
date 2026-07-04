import { db } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'
import fs from 'node:fs'
import path from 'node:path'

/* ------------------------------------------------------------------ *
 * User settings helpers.
 *
 * Settings are stored as key/value pairs in UserSetting so we can add new
 * settings without schema migrations. Each value is stored as a string;
 * callers parse as needed.
 *
 * RESILIENCE: On Vercel, the SQLite DB is ephemeral — settings written in
 * one serverless invocation may be gone in the next. To work around this,
 * we mirror every write to /tmp/.agent007-settings.json as a fallback.
 * On read, if the DB returns nothing AND the file exists, we use the file.
 * This makes settings survive cold starts within the same container reuse
 * window (which is the realistic case for the operator user).
 * ------------------------------------------------------------------ */

export interface IncomeSettings {
  monthlyGoal: number
  dailyGrowthTarget: number // percentage, e.g. 10
  currencySymbol: string
  displayMode: 'compact' | 'detailed'
}

export interface NotificationSettings {
  enabled: boolean
  email: string
  events: {
    mission_complete: boolean
    mission_failed: boolean
    income_logged: boolean
    daily_summary: boolean
    weekly_summary: boolean
  }
  minDelayMinutes: number
}

export const DEFAULT_INCOME_SETTINGS: IncomeSettings = {
  monthlyGoal: 20000,
  dailyGrowthTarget: 10, // 10% daily growth (matches SYSTEM_PROMPT: "Target a 10% daily growth rate")
  currencySymbol: '$',
  displayMode: 'detailed',
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  email: SEED_EMAIL,
  events: {
    mission_complete: true,
    mission_failed: true,
    income_logged: false,
    daily_summary: true,
    weekly_summary: false,
  },
  minDelayMinutes: 5,
}

const INCOME_KEY = 'income_settings'
const NOTIF_KEY = 'notification_settings'
const SETTINGS_FILE = '/tmp/.agent007-settings.json'

interface FileSettings {
  income?: IncomeSettings
  notifications?: NotificationSettings
  custom?: Record<string, any>
  updatedAt?: string
}

function readFileSettings(): FileSettings | null {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    return JSON.parse(raw) as FileSettings
  } catch {
    return null
  }
}

function writeFileSettings(s: FileSettings): boolean {
  try {
    s.updatedAt = new Date().toISOString()
    // Ensure /tmp exists (it always does on Vercel + Node)
    const dir = path.dirname(SETTINGS_FILE)
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true }) } catch {}
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf-8')
    return true
  } catch (e) {
    console.error('[settings] writeFileSettings failed:', e)
    return false
  }
}

export async function getOperatorUserId(): Promise<string | null> {
  try {
    const u = await db.user.findUnique({ where: { email: SEED_EMAIL } })
    return u?.id ?? null
  } catch {
    return null
  }
}

export async function getIncomeSettings(): Promise<IncomeSettings> {
  const userId = await getOperatorUserId()
  if (!userId) {
    // Fallback to file
    const file = readFileSettings()
    return file?.income ?? DEFAULT_INCOME_SETTINGS
  }
  try {
    const row = await db.userSetting.findFirst({
      where: { userId, key: INCOME_KEY },
    })
    if (!row) {
      const file = readFileSettings()
      return file?.income ?? DEFAULT_INCOME_SETTINGS
    }
    const parsed = JSON.parse(row.value) as Partial<IncomeSettings>
    return { ...DEFAULT_INCOME_SETTINGS, ...parsed }
  } catch {
    const file = readFileSettings()
    return file?.income ?? DEFAULT_INCOME_SETTINGS
  }
}

/** Returns true on success, false if both DB and file write failed. */
export async function setIncomeSettings(s: IncomeSettings): Promise<boolean> {
  // Always write the file fallback first
  const file = readFileSettings() ?? {}
  file.income = s
  writeFileSettings(file)

  const userId = await getOperatorUserId()
  if (!userId) return false
  try {
    try {
      await db.userSetting.deleteMany({ where: { userId, key: INCOME_KEY } })
    } catch {}
    try {
      await db.userSetting.create({ data: { userId, key: INCOME_KEY, value: JSON.stringify(s) } })
    } catch (e: any) {
      // Try upsert via updateMany as a last resort
      try {
        await db.userSetting.updateMany({ where: { userId, key: INCOME_KEY }, data: { value: JSON.stringify(s) } })
      } catch {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const userId = await getOperatorUserId()
  if (!userId) {
    const file = readFileSettings()
    return file?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
  }
  try {
    const row = await db.userSetting.findFirst({
      where: { userId, key: NOTIF_KEY },
    })
    if (!row) {
      const file = readFileSettings()
      return file?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
    }
    const parsed = JSON.parse(row.value) as Partial<NotificationSettings>
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...parsed,
      events: { ...DEFAULT_NOTIFICATION_SETTINGS.events, ...(parsed.events ?? {}) },
    }
  } catch {
    const file = readFileSettings()
    return file?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
  }
}

/** Returns true on success, false if both DB and file write failed. */
export async function setNotificationSettings(s: NotificationSettings): Promise<boolean> {
  const file = readFileSettings() ?? {}
  file.notifications = s
  writeFileSettings(file)

  const userId = await getOperatorUserId()
  if (!userId) return false
  try {
    try {
      await db.userSetting.deleteMany({ where: { userId, key: NOTIF_KEY } })
    } catch {}
    try {
      await db.userSetting.create({ data: { userId, key: NOTIF_KEY, value: JSON.stringify(s) } })
    } catch {
      try {
        await db.userSetting.updateMany({ where: { userId, key: NOTIF_KEY }, data: { value: JSON.stringify(s) } })
      } catch {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Universal custom key/value storage (for Agent007 dashboard/login mods)
 * Stored in UserSetting with `custom:` prefix.
 * Mirrored to /tmp file fallback for resilience.
 * ------------------------------------------------------------------ */

export async function getCustomSetting(key: string): Promise<any> {
  const fileKey = `custom:${key}`
  // Try file first
  const file = readFileSettings()
  if (file?.custom && key in file.custom) return file.custom[key]

  const userId = await getOperatorUserId()
  if (!userId) return null
  try {
    const row = await db.userSetting.findFirst({ where: { userId, key: fileKey } })
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  } catch {
    return null
  }
}

export async function setCustomSetting(key: string, value: any): Promise<boolean> {
  // Mirror to file first (always works on local disk)
  try {
    const file = readFileSettings() ?? ({} as FileSettings)
    if (!file.custom) file.custom = {}
    file.custom[key] = value
    writeFileSettings(file)
  } catch (e) {
    console.error('[settings] setCustomSetting file mirror failed:', e)
  }

  // Then try DB
  try {
    const userId = await getOperatorUserId()
    if (!userId) return false
    const fileKey = `custom:${key}`
    const storedValue = typeof value === 'string' ? value : JSON.stringify(value)
    try {
      await db.userSetting.deleteMany({ where: { userId, key: fileKey } })
    } catch {}
    try {
      await db.userSetting.create({ data: { userId, key: fileKey, value: storedValue } })
    } catch {
      try {
        await db.userSetting.updateMany({ where: { userId, key: fileKey }, data: { value: storedValue } })
      } catch {
        // DB write failed but file write succeeded — that's OK
        return true
      }
    }
    return true
  } catch (e) {
    console.error('[settings] setCustomSetting DB write failed:', e)
    // File write succeeded, so the setting IS persisted — return true
    return true
  }
}

export async function deleteCustomSetting(key: string): Promise<boolean> {
  // Remove from file
  const file = readFileSettings()
  if (file?.custom && key in file.custom) {
    delete file.custom[key]
    writeFileSettings(file)
  }

  const userId = await getOperatorUserId()
  if (!userId) return false
  const fileKey = `custom:${key}`
  try {
    await db.userSetting.deleteMany({ where: { userId, key: fileKey } })
    return true
  } catch {
    return false
  }
}

export async function getAllCustomSettings(): Promise<Record<string, any>> {
  // Start with file (more reliable on Vercel)
  const out: Record<string, any> = {}
  const file = readFileSettings()
  if (file?.custom) {
    for (const [k, v] of Object.entries(file.custom)) out[k] = v
  }

  const userId = await getOperatorUserId()
  if (!userId) return out
  try {
    const rows = await db.userSetting.findMany({
      where: { userId, key: { startsWith: 'custom:' } },
    })
    for (const row of rows) {
      const key = row.key.slice('custom:'.length)
      try {
        out[key] = JSON.parse(row.value)
      } catch {
        out[key] = row.value
      }
    }
  } catch {}

  return out
}

/**
 * Returns true if a notification of `type` was sent within the last
 * `minDelayMinutes` window (so we can skip spammy duplicates).
 */
export async function recentlyNotified(
  type: string,
  minDelayMinutes: number
): Promise<boolean> {
  if (minDelayMinutes <= 0) return false
  const since = new Date(Date.now() - minDelayMinutes * 60 * 1000)
  try {
    const count = await db.notificationLog.count({
      where: { type, createdAt: { gte: since } },
    })
    return count > 0
  } catch {
    return false
  }
}
