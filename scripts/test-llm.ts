import { callLlmWithRetry, friendlyLlmError } from '../src/lib/agent'

async function test() {
  console.log('Testing LLM call...')
  console.log('OPENAI_API_KEY env:', process.env.OPENAI_API_KEY ? 'SET (' + process.env.OPENAI_API_KEY.slice(0, 7) + '...)' : 'NOT SET')
  console.log('ZAI_API_KEY env:', process.env.ZAI_API_KEY ? 'SET' : 'NOT SET')
  console.log()
  
  try {
    const result = await callLlmWithRetry([
      { role: 'system', content: 'You are a test assistant. Reply with exactly: OK' },
      { role: 'user', content: 'Say OK' },
    ])
    console.log('✅ LLM call SUCCESS')
    console.log('Response:', JSON.stringify(result).slice(0, 200))
  } catch (e: any) {
    console.log('❌ LLM call FAILED')
    console.log('Raw error:', e?.message?.slice(0, 300))
    console.log()
    console.log('Friendly error:', friendlyLlmError(e))
    console.log()
    console.log('Status:', e?.status)
    console.log('Response status:', e?.response?.status)
  }
  
  process.exit(0)
}
test().catch(e => { console.error(e); process.exit(1) })
