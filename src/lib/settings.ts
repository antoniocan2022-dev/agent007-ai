import { db } from '@/lib/db'
import { SEED_EMAIL } from '@/lib/auth'

/* ------------------------------------------------------------------ *
 * User settings helpers.
 *
 * Settings are stored as key/value pairs in UserSetting so we can add new
 * settings without schema migrations. Each value is stored as a string;
 * callers parse as needed.
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
  dailyGrowthTarget: 20,
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
  if (!userId) return DEFAULT_INCOME_SETTINGS
  try {
    const row = await db.userSetting.findFirst({
      where: { userId, key: INCOME_KEY },
    })
    if (!row) return DEFAULT_INCOME_SETTINGS
    const parsed = JSON.parse(row.value) as Partial<IncomeSettings>
    return { ...DEFAULT_INCOME_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_INCOME_SETTINGS
  }
}

export async function setIncomeSettings(s: IncomeSettings): Promise<void> {
  const userId = await getOperatorUserId()
  if (!userId) return
  try {
    await db.userSetting.deleteMany({ where: { userId, key: INCOME_KEY } })
  } catch {}
  try {
    await db.userSetting.create({ data: { userId, key: INCOME_KEY, value: JSON.stringify(s) } })
  } catch {}
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const userId = await getOperatorUserId()
  if (!userId) return DEFAULT_NOTIFICATION_SETTINGS
  try {
    const row = await db.userSetting.findFirst({
      where: { userId, key: NOTIF_KEY },
    })
    if (!row) return DEFAULT_NOTIFICATION_SETTINGS
    const parsed = JSON.parse(row.value) as Partial<NotificationSettings>
    return {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...parsed,
      events: { ...DEFAULT_NOTIFICATION_SETTINGS.events, ...(parsed.events ?? {}) },
    }
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS
  }
}

export async function setNotificationSettings(s: NotificationSettings): Promise<void> {
  const userId = await getOperatorUserId()
  if (!userId) return
  try {
    await db.userSetting.deleteMany({ where: { userId, key: NOTIF_KEY } })
  } catch {}
  try {
    await db.userSetting.create({ data: { userId, key: NOTIF_KEY, value: JSON.stringify(s) } })
  } catch {}
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
