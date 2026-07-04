import { db } from '../src/lib/db'

async function testOpenAI() {
  // Get the key from DB
  const dbKey = await db.apiKey.findFirst({
    where: { service: 'openai' },
    orderBy: { createdAt: 'desc' },
  }).catch(() => null)

  if (!dbKey?.key) {
    console.log('❌ No OpenAI key found in DB')
    return
  }

  // De-obfuscate the key (stored as base64 with salt)
  let apiKey = dbKey.key
  try {
    const OBF_SALT = 'agent007-obf-salt-2024'
    const decoded = Buffer.from(dbKey.key, 'base64').toString('utf-8')
    if (decoded.includes(OBF_SALT)) {
      apiKey = decoded.replace(OBF_SALT, '')
    }
  } catch {}

  console.log('Key preview:', apiKey.slice(0, 15) + '...')
  console.log('Key length:', apiKey.length)
  console.log()

  // Test the key by calling OpenAI API
  console.log('Testing OpenAI API call...')
  const start = Date.now()
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Reply concisely.' },
          { role: 'user', content: 'Say exactly: OPENAI KEY WORKS' },
        ],
        max_tokens: 50,
      }),
    })

    const elapsed = Date.now() - start
    console.log('HTTP Status:', res.status)
    console.log('Response time:', elapsed + 'ms')

    if (res.ok) {
      const data = await res.json()
      const content = data?.choices?.[0]?.message?.content ?? ''
      console.log()
      console.log('✅ OPENAI KEY WORKS!')
      console.log('  Model:', data?.model)
      console.log('  Response:', content)
      console.log('  Tokens used:', data?.usage?.total_tokens)
    } else {
      const text = await res.text()
      console.log()
      console.log('❌ OPENAI KEY FAILED')
      console.log('  Status:', res.status)
      console.log('  Error:', text.slice(0, 300))
      
      if (res.status === 401) {
        console.log()
        console.log('  CAUSE: API key is invalid or expired')
        console.log('  FIX: Get a new key at https://platform.openai.com/api-keys')
      } else if (res.status === 403) {
        console.log()
        console.log('  CAUSE: API key does not have permission')
        console.log('  FIX: Check key permissions at https://platform.openai.com/api-keys')
      } else if (res.status === 429) {
        console.log()
        console.log('  CAUSE: Rate limit or out of credits')
        console.log('  FIX: Check credits at https://platform.openai.com/account/billing')
      }
    }
  } catch (e: any) {
    console.log('❌ Network error:', e?.message)
  }

  process.exit(0)
}
testOpenAI().catch(e => { console.error(e); process.exit(1) })
