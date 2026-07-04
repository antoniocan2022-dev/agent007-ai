import { db } from '../src/lib/db'

async function verify() {
  const dbKey = await db.apiKey.findFirst({
    where: { service: 'openai' },
    orderBy: { createdAt: 'desc' },
  }).catch(() => null)

  if (!dbKey?.key) {
    console.log('No key found')
    process.exit(1)
  }

  let apiKey = dbKey.key
  try {
    const OBF_SALT = 'agent007-obf-salt-2024'
    const decoded = Buffer.from(dbKey.key, 'base64').toString('utf-8')
    if (decoded.includes(OBF_SALT)) {
      apiKey = decoded.replace(OBF_SALT, '')
    }
  } catch {}

  // Check key format
  console.log('Key format check:')
  console.log('  Starts with sk-:', apiKey.startsWith('sk-'))
  console.log('  Starts with sk-proj-:', apiKey.startsWith('sk-proj-'))
  console.log('  Length:', apiKey.length, '(valid keys are 100-200 chars)')
  console.log()

  // Try /v1/models (lighter endpoint)
  console.log('Testing /v1/models endpoint...')
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    })
    console.log('  Status:', res.status)
    if (res.ok) {
      const data = await res.json()
      console.log('  ✅ KEY IS VALID — can list models')
      console.log('  Available models:', data?.data?.length)
    } else {
      const text = await res.text()
      console.log('  Response:', text.slice(0, 200))
      
      // Parse error code
      try {
        const err = JSON.parse(text)
        const code = err?.error?.code
        if (code === 'unsupported_country_region_territory') {
          console.log()
          console.log('  ═══════════════════════════════════════════════════')
          console.log('  ⚠️  REGION BLOCKED BY OPENAI')
          console.log('  ═══════════════════════════════════════════════════')
          console.log('  The API key is VALID, but OpenAI blocks requests')
          console.log('  from this server region.')
          console.log()
          console.log('  This is NOT a key problem — it is a geographic')
          console.log('  restriction imposed by OpenAI.')
          console.log()
          console.log('  SOLUTIONS:')
          console.log('  1. Deploy to Vercel (US servers) — OpenAI works there')
          console.log('  2. Use Z.ai SDK (already working in dev)')
          console.log('  3. Use a VPN/proxy to route OpenAI through US')
          console.log('  ═══════════════════════════════════════════════════')
        }
      } catch {}
    }
  } catch (e: any) {
    console.log('  Error:', e?.message)
  }

  process.exit(0)
}
verify().catch(e => { console.error(e); process.exit(1) })
