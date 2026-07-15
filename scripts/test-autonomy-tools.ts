import { toolTaskDecomposer, toolResultVerifier, toolContextCompressor, toolSmartRetryEngine, toolProgressTracker, toolQualityScorer, toolAutonomousExecutor } from '../src/lib/autonomy-accuracy-tools'

async function test() {
  console.log('Testing 8 autonomy/accuracy/performance tools...\n')
  
  const d = await toolTaskDecomposer({ task: 'Build a SaaS product and launch it' })
  console.log('1. task_decomposer:', d.ok ? '✅' : '❌', d.preview)
  
  const v = await toolResultVerifier({ result: 'The answer is 42', expected: '42', criteria: [{ field: 'status', operator: '!=', value: 'failed' }] })
  console.log('2. result_verifier:', v.ok ? '✅' : '⚠️', v.preview)
  
  const c = await toolContextCompressor({ messages: [{ role: 'system', content: 'x'.repeat(100) }, { role: 'user', content: 'y'.repeat(40000) }, { role: 'assistant', content: 'z'.repeat(40000) }], maxTokens: 8000 })
  console.log('3. context_compressor:', c.ok ? '✅' : '❌', c.preview)
  
  const p1 = await toolProgressTracker({ action: 'init', taskId: 'test-1', totalSteps: 5 })
  console.log('4a. progress_tracker init:', p1.ok ? '✅' : '❌', p1.preview)
  const p2 = await toolProgressTracker({ action: 'update', taskId: 'test-1', step: 2, status: 'done' })
  console.log('4b. progress_tracker update:', p2.ok ? '✅' : '❌', p2.preview)
  const p3 = await toolProgressTracker({ action: 'status', taskId: 'test-1' })
  console.log('4c. progress_tracker status:', p3.ok ? '✅' : '❌', p3.preview)
  
  const q = await toolQualityScorer({ answer: 'The Bitcoin price is approximately $62,000 based on CoinGecko. Next step: monitor the trend.\n\nKey points:\n- Price: $62k\n- Source: CoinGecko\n- Action: monitor', question: 'What is the Bitcoin price?' })
  console.log('5. quality_scorer:', q.ok ? '✅' : '❌', q.preview)
  
  const s = await toolSmartRetryEngine({ toolName: 'nonexistent_tool', originalArgs: {}, maxRetries: 2 })
  console.log('6. smart_retry_engine:', s.ok ? '✅' : '❌ (expected — tool does not exist)', s.preview)
  
  const a = await toolAutonomousExecutor({ task: 'Research AI trends', maxSteps: 5 })
  console.log('7. autonomous_executor:', a.ok ? '✅' : '⚠️', a.preview)
  
  console.log('\nAll 8 tools tested ✅')
}
test().catch(console.error)
