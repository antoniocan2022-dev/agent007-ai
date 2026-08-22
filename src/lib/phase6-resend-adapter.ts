import type { CommercialProviderAdapter } from './phase6-commercial-execution'

function resolveSecret(secretRef: string): string {
  const prefix = 'env:'
  if (!secretRef.startsWith(prefix)) throw new Error('Resend adapter requires an env-backed opaque credential reference (env:NAME).')
  const envName = secretRef.slice(prefix.length).trim()
  if (!/^[A-Z][A-Z0-9_]+$/.test(envName)) throw new Error('Invalid environment credential reference.')
  const secret = process.env[envName]
  if (!secret) throw new Error(`Credential environment variable is not configured: ${envName}`)
  return secret
}

export const resendCommercialProviderAdapter: CommercialProviderAdapter = {
  manifest: {
    id: 'resend',
    displayName: 'Resend',
    version: '1.0.0',
    capabilities: ['communications'],
    environments: ['live', 'sandbox'],
  },

  async execute(context, input) {
    const to = Array.isArray(input.to) ? input.to.map(String) : [String(input.to ?? '')]
    const subject = String(input.subject ?? '').trim()
    const html = String(input.html ?? input.text ?? '').trim()
    const from = String(input.from ?? process.env.RESEND_FROM ?? '').trim()
    if (to.length === 0 || !to.every((value) => value.includes('@'))) throw new Error('Resend requires at least one valid recipient.')
    if (!subject) throw new Error('Resend requires a subject.')
    if (!html) throw new Error('Resend requires message content.')
    if (!from) throw new Error('Resend requires a configured sender (input.from or RESEND_FROM).')

    if (context.mode === 'sandbox') {
      return {
        providerStatus: 'sandboxed',
        providerObjectId: `sandbox_${context.idempotencyKey}`,
        output: { accepted: true, mode: 'sandbox', to, subject, from },
        verificationRequired: false,
      }
    }

    const apiKey = resolveSecret(context.credential.secretRef)
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new Error(`Resend request failed with HTTP ${response.status}: ${JSON.stringify(data).slice(0, 500)}`)
    const providerObjectId = typeof data.id === 'string' ? data.id : null
    if (!providerObjectId) throw new Error('Resend response did not contain an email id; delivery evidence is insufficient.')
    return { providerStatus: 'accepted', providerObjectId, output: { accepted: true, providerObjectId, to, subject, from }, verificationRequired: true }
  },

  async verify(context, result) {
    if (context.mode === 'sandbox') return { verified: true, evidence: { mode: 'sandbox', providerStatus: result.providerStatus ?? null } }
    if (!result.providerObjectId) return { verified: false, evidence: {}, reason: 'Resend did not return a provider object id.' }
    return { verified: true, evidence: { provider: 'resend', providerObjectId: result.providerObjectId, providerStatus: result.providerStatus ?? 'accepted' } }
  },

  async health() {
    return { status: process.env.RESEND_API_KEY ? 'healthy' : 'unknown', detail: process.env.RESEND_API_KEY ? 'Credential environment is configured.' : 'RESEND_API_KEY is not configured.' }
  },
}
