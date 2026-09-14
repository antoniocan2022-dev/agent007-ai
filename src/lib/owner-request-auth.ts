import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isOwnerEmail } from '@/lib/owner-config'

/**
 * Shared owner-only request guard for system/backup/2FA routes that must be reachable
 * either from the owner's logged-in browser session, or from this app's own internal
 * server-to-server calls (orchestrator.ts's internalFetch hits these routes over real
 * HTTP and cannot forward a browser session cookie). Reuses CRON_SECRET as the trusted
 * internal-caller bearer token -- the same secret that already gates every other
 * server-to-server call in this app (autonomy heartbeat, schedules/tick, monitors) --
 * rather than introducing a second secret to configure. Fails closed: with no session
 * and no correctly-configured secret, access is denied.
 *
 * Deep-audit fix: this originally accepted ANY authenticated session (`session?.user`), not just
 * the owner's. This app supports multi-user registration (src/app/api/auth/register), so a
 * non-owner account could reach every route this guard protects -- including backup export/
 * restore and 2FA disable. Checks isOwnerEmail() specifically now. (Self-registration itself is
 * now also gated on owner approval -- see user-approval.ts / auth.ts's authorize() -- but this
 * guard should not depend on that being the only line of defense.)
 */
export async function isAuthorizedOwnerRequest(req: NextRequest): Promise<boolean> {
  const session = await getServerSession(authOptions).catch(() => null)
  if (isOwnerEmail(session?.user?.email)) return true
  const secret = process.env.CRON_SECRET?.trim()
  return Boolean(secret && req.headers.get('authorization') === `Bearer ${secret}`)
}
