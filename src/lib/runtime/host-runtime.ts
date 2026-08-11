/**
 * Host runtime identity is exposed through a neutral contract.
 * Provider-specific environment variables remain confined to this adapter.
 */
export type HostProvider = 'vercel' | 'generic'

export function getHostProvider(): HostProvider {
  return process.env.VERCEL === '1' ? 'vercel' : 'generic'
}

export function isVercelRuntime(): boolean {
  return getHostProvider() === 'vercel'
}
