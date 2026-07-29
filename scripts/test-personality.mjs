// Live personality test — calls the deployed agent at agent007-ai.vercel.app
// with the same question Antonio asked, captures the response.
const URL = 'https://agent007-ai.vercel.app/api/agent'
const QUESTION = "What are your strengths and weaknesses? What can I do to make the best of our partnership?"
const CONVO_ID = `personality-test-${Date.now()}`

const body = JSON.stringify({
  message: QUESTION,
  conversationId: CONVO_ID,
  attachments: [],
  language: 'en',
})

console.log('Asking the LIVE deployed agent:')
console.log(`Q: "${QUESTION}"`)
console.log(`Conversation: ${CONVO_ID}`)
console.log('---waiting for response (up to 290s)---\n')

const start = Date.now()
try {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(290_000),
  })
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '')
    console.error(`HTTP ${res.status}: ${txt.slice(0, 400)}`)
    process.exit(1)
  }
  // SSE stream
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let tokens = []
  let finalAnswer = ''
  let stepCount = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE messages separated by \n\n
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const part of parts) {
      const lines = part.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        try {
          const ev = JSON.parse(data)
          if (ev.event === 'token' && ev.data?.content) {
            tokens.push(ev.data.content)
          } else if (ev.event === 'thought' && ev.data?.content) {
            // Skip thoughts — we want the final response
          } else if (ev.event === 'tool_call') {
            stepCount++
          } else if (ev.event === 'done') {
            // Final answer in tokens
            finalAnswer = tokens.join('')
          } else if (ev.event === 'error') {
            console.error('Stream error:', ev.data?.message ?? ev.data)
          }
        } catch (e) {
          // partial JSON — skip
        }
      }
    }
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n=== Response (took ${elapsed}s, ${stepCount} tool calls) ===\n`)
  console.log(finalAnswer || '(no final answer captured — printing all tokens)')
  if (!finalAnswer) console.log(tokens.join(''))
} catch (e) {
  console.error('Fetch failed:', e?.message ?? e)
  process.exit(1)
}
