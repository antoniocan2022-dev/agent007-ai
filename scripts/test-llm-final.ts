import { callLlmWithRetry } from '../src/lib/agent'

async function test() {
  console.log('Calling LLM...')
  const start = Date.now()
  try {
    const result = await callLlmWithRetry([
      { role: 'system', content: 'You are a helpful assistant. Reply concisely.' },
      { role: 'user', content: 'Confirm you are working. Reply with: YES, I am working.' },
    ])
    const elapsed = Date.now() - start
    const content = result?.choices?.[0]?.message?.content ?? ''
    const model = result?.model ?? 'unknown'
    console.log('✅ LLM CALL SUCCESS')
    console.log('  Model:', model)
    console.log('  Response:', content)
    console.log('  Time:', elapsed + 'ms')
    console.log('  Provider:', result?._provider ?? (process.env.OPENAI_API_KEY ? 'openai' : 'z-ai'))
  } catch (e: any) {
    console.log('❌ LLM CALL FAILED')
    console.log('  Error:', e?.message?.slice(0, 200))
  }
  process.exit(0)
}
test().catch(e => { console.error(e); process.exit(1) })
