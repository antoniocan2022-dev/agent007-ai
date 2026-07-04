import { db } from '../src/lib/db'

async function test() {
  // Get key from DB
  const dbKey = await db.apiKey.findFirst({
    where: { service: 'openai' },
    orderBy: { createdAt: 'desc' },
  }).catch(() => null)

  if (!dbKey?.key) {
    console.log('❌ No OpenAI key found in DB')
    process.exit(1)
  }

  // De-obfuscate
  let apiKey = dbKey.key
  try {
    const OBF_SALT = 'agent007-obf-salt-2024'
    const decoded = Buffer.from(dbKey.key, 'base64').toString('utf-8')
    if (decoded.includes(OBF_SALT)) {
      apiKey = decoded.replace(OBF_SALT, '')
    }
  } catch {}

  console.log('Key found in DB: ✅')
  console.log('  Preview:', apiKey.slice(0, 15) + '...')
  console.log('  Length:', apiKey.length, 'chars')
  console.log('  Format:', apiKey.startsWith('sk-proj-') ? '✅ Project key (sk-proj-)' : apiKey.startsWith('sk-') ? '✅ Standard key (sk-)' : '⚠️ Unknown format')
  console.log()

  // Test 1: List models (lightweight check)
  console.log('=== Test 1: GET /v1/models (key validation) ===')
  try {
    const start = Date.now()
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    })
    const elapsed = Date.now() - start
    console.log('  HTTP Status:', res.status)
    console.log('  Time:', elapsed + 'ms')
    
    if (res.ok) {
      const data = await res.json()
      console.log('  ✅ KEY IS VALID!')
      console.log('  Available models:', data?.data?.length)
      console.log('  Sample models:', data?.data?.slice(0, 5).map((m: any) => m.id).join(', '))
    } else {
      const text = await res.text()
      console.log('  ❌ FAILED:', text.slice(0, 200))
      try {
        const err = JSON.parse(text)
        console.log('  Error code:', err?.error?.code)
      } catch {}
    }
  } catch (e: any) {
    console.log('  ❌ Network error:', e?.message)
  }
  console.log()

  // Test 2: Chat completion (actual LLM call)
  console.log('=== Test 2: POST /v1/chat/completions (LLM call) ===')
  try {
    const start = Date.now()
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a test assistant. Be concise.' },
          { role: 'user', content: 'Reply with exactly: OPENAI KEY CONFIRMED WORKING' },
        ],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const elapsed = Date.now() - start
    console.log('  HTTP Status:', res.status)
    console.log('  Time:', elapsed + 'ms')
    
    if (res.ok) {
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      console.log('  ✅ LLM CALL SUCCESS!')
      console.log('  Model:', data?.model)
      console.log('  Response:', content)
      console.log('  Tokens:', data?.usage?.total_tokens)
      console.log('  Cost:', '$' + ((data?.usage?.total_tokens || 0) * 0.00000015).toFixed(6))
    } else {
      const text = await res.text()
      console.log('  ❌ FAILED:', text.slice(0, 300))
      try {
        const err = JSON.parse(text)
        console.log('  Error code:', err?.error?.code)
        if (err?.error?.code === 'unsupported_country_region_territory') {
          console.log()
          console.log('  ⚠️  REGION BLOCKED')
          console.log('  The key is VALID but OpenAI blocks this server region.')
          console.log('  This key WILL work on Vercel (US servers).')
        }
      } catch {}
    }
  } catch (e: any) {
    console.log('  ❌ Network error:', e?.message)
  }

  process.exit(0)
}
test().catch(e => { console.error(e); process.exit(1) })
