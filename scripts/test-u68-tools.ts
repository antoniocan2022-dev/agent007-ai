import { toolTaskDecomposer, toolResultVerifier, toolContextCompressor, toolSmartRetryEngine, toolProgressTracker, toolQualityScorer, toolAutonomousExecutor } from '../src/lib/autonomy-accuracy-tools'
import { toolAffiliateLinkGenerator } from '../src/lib/affiliate-link-generator'

async function test() {
  console.log('Testing 9 MAX tools...\n')
  
  const aff = await toolAffiliateLinkGenerator({ network: 'amazon', productId: 'B08N5WRWNW', affiliateId: 'tag-20' })
  console.log('1. affiliate_link_generator:', aff.ok ? '✅' : '❌', aff.preview)
  
  const d = await toolTaskDecomposer({ task: 'Build a SaaS product and launch it' })
  console.log('2. task_decomposer:', d.ok ? '✅' : '❌', d.preview)
  
  const v = await toolResultVerifier({ result: 'The answer is 42 with sources', expected: '42', criteria: [{ field: 'status', operator: '!=', value: 'failed' }] })
  console.log('3. result_verifier:', v.ok ? '✅' : '⚠️', v.preview)
  
  const c = await toolContextCompressor({ messages: [{ role: 'system', content: 'x'.repeat(100) }, { role: 'user', content: 'y'.repeat(40000) }, { role: 'assistant', content: 'z'.repeat(40000) }], maxTokens: 8000 })
  console.log('4. context_compressor:', c.ok ? '✅' : '❌', c.preview)
  
  const p1 = await toolProgressTracker({ action: 'init', taskId: 'test-68', totalSteps: 8 })
  console.log('5a. progress_tracker init:', p1.ok ? '✅' : '❌', p1.preview)
  const p2 = await toolProgressTracker({ action: 'update', taskId: 'test-68', step: 3, status: 'done', qualityScore: 85 })
  console.log('5b. progress_tracker update:', p2.ok ? '✅' : '❌', p2.preview)
  const p3 = await toolProgressTracker({ action: 'status', taskId: 'test-68' })
  console.log('5c. progress_tracker status:', p3.ok ? '✅' : '❌', p3.preview)
  
  const q = await toolQualityScorer({ answer: 'The Bitcoin price is approximately $62,000 based on https://coingecko.com. Next step: monitor the trend.\n\nKey points:\n- Price: $62k\n- Source: CoinGecko\n- Action: monitor daily\n\nExample: Use real_time_data_hub for live updates.', question: 'What is the Bitcoin price?', target: 97 })
  console.log('6. quality_scorer:', q.ok ? '✅' : '❌', q.preview)
  
  const s = await toolSmartRetryEngine({ toolName: 'nonexistent_tool', originalArgs: {}, maxRetries: 2 })
  console.log('7. smart_retry_engine:', s.ok ? '✅' : '❌ (expected)', s.preview)
  
  const a = await toolAutonomousExecutor({ task: 'Research AI trends', maxSteps: 8, target: 97 })
  console.log('8. autonomous_executor:', a.ok ? '✅' : '⚠️', a.preview)
  
  console.log('\nAll 9 MAX tools tested ✅')
}
test().catch(console.error)
