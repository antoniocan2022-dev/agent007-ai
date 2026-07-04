import { callLlmWithRetry, friendlyLlmError } from '../src/lib/agent'

async function test() {
  console.log('Testing Z.ai SDK (primary provider)...')
  const start = Date.now()
  try {
    const result = await callLlmWithRetry([
      { role: 'system', content: 'Reply concisely.' },
      { role: 'user', content: 'Say exactly: Z.AI WORKS' },
    ])
    const elapsed = Date.now() - start
    const content = result?.choices?.[0]?.message?.content ?? ''
    console.log('✅ Z.AI SDK WORKS')
    console.log('  Model:', result?.model)
    console.log('  Response:', content)
    console.log('  Time:', elapsed + 'ms')
    console.log('  Provider:', result?._provider ?? 'z-ai')
  } catch (e: any) {
    console.log('❌ Z.AI FAILED:', e?.message?.slice(0, 200))
  }
  process.exit(0)
}
test().catch(e => { console.error(e); process.exit(1) })
