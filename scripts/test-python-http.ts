/**
 * test-python-http.ts — functional test for python_exec + http_request tools.
 * Uses jsonplaceholder.typicode.com (reliable) instead of httpbin.org (flaky).
 */
import { dispatchTool, type ToolContext } from '../src/lib/tools'

let pass = 0
let fail = 0
function assert(cond: boolean, label: string) {
  if (cond) { console.log(`✅ ${label}`); pass++ }
  else { console.log(`❌ ${label}`); fail++ }
}

const ctx: ToolContext = { attachments: [], language: 'en' }

async function main() {
  // === 1. python_exec — basic print ===
  console.log('\n--- 1. python_exec: basic print ---')
  const py1 = await dispatchTool('python_exec', { code: 'print("Hello from Python!"); print(2 + 2)' }, ctx)
  assert(py1.ok === true, 'python_exec succeeds')
  assert(py1.result.includes('Hello from Python!'), 'stdout contains greeting')
  assert(py1.result.includes('4'), 'stdout contains 2+2=4')

  // === 2. python_exec — numpy + pandas ===
  console.log('\n--- 2. python_exec: numpy + pandas ---')
  const py2 = await dispatchTool('python_exec', {
    code: `
import numpy as np
import pandas as pd
arr = np.array([1, 2, 3, 4, 5])
print("numpy mean:", np.mean(arr))
df = pd.DataFrame({'name': ['Alice', 'Bob', 'Charlie'], 'score': [95, 87, 92]})
print("pandas shape:", df.shape)
print(df.to_string(index=False))
`,
  }, ctx)
  assert(py2.ok === true, 'python_exec with numpy+pandas succeeds')
  assert(py2.result.includes('numpy mean: 3.0'), 'numpy mean correct')
  assert(py2.result.includes('pandas shape: (3, 2)'), 'pandas shape correct')
  assert(py2.result.includes('Alice'), 'pandas DataFrame content present')

  // === 3. python_exec — network access (requests) ===
  console.log('\n--- 3. python_exec: network access via requests ---')
  const py3 = await dispatchTool('python_exec', {
    code: `
import requests
r = requests.get('https://api.github.com/repos/microsoft/vscode', timeout=10)
print("status:", r.status_code)
data = r.json()
print("repo:", data.get('full_name'))
print("stars:", data.get('stargazers_count'))
`,
    timeout: 20,
  }, ctx)
  assert(py3.ok === true, 'python_exec with network access succeeds')
  assert(py3.result.includes('status: 200'), 'HTTP 200 from GitHub API')
  assert(py3.result.includes('microsoft/vscode'), 'repo name echoed back')

  // === 4. python_exec — error handling ===
  console.log('\n--- 4. python_exec: error handling ---')
  const py4 = await dispatchTool('python_exec', { code: 'raise ValueError("intentional error")' }, ctx)
  assert(py4.ok === false, 'python_exec with error returns ok=false')
  assert(py4.result.includes('ValueError'), 'error message contains ValueError')
  assert(py4.result.includes('intentional error'), 'error message contains the error text')

  // === 5. python_exec — missing code arg ===
  console.log('\n--- 5. python_exec: missing code arg ---')
  const py5 = await dispatchTool('python_exec', {}, ctx)
  assert(py5.ok === false, 'python_exec without code fails')
  assert(py5.result.includes('Missing "code"'), 'helpful error message')

  // === 6. http_request — GET ===
  console.log('\n--- 6. http_request: GET ---')
  const http1 = await dispatchTool('http_request', {
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    method: 'GET',
  }, ctx)
  assert(http1.ok === true, 'http_request GET succeeds')
  assert(http1.result.includes('Status: 200'), 'HTTP 200 status')
  assert(http1.result.includes('"id": 1'), 'response body contains post id')

  // === 7. http_request — POST with JSON body ===
  console.log('\n--- 7. http_request: POST with JSON body ---')
  const http2 = await dispatchTool('http_request', {
    url: 'https://jsonplaceholder.typicode.com/posts',
    method: 'POST',
    body: { title: 'Agent007 Test', body: 'Hello from Agent007', userId: 1 },
  }, ctx)
  assert(http2.ok === true, 'http_request POST succeeds')
  assert(http2.result.includes('Status: 201') || http2.result.includes('Status: 200'), 'HTTP 2xx status')
  assert(http2.result.includes('Agent007 Test'), 'POST title echoed back')

  // === 8. http_request — PUT ===
  console.log('\n--- 8. http_request: PUT ===')
  const http3 = await dispatchTool('http_request', {
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    method: 'PUT',
    body: { id: 1, title: 'Updated by Agent007', body: 'Updated body', userId: 1 },
  }, ctx)
  assert(http3.ok === true, 'http_request PUT succeeds')
  assert(http3.result.includes('Status: 2'), 'HTTP 2xx status')
  assert(http3.result.includes('Updated by Agent007'), 'PUT body echoed back')

  // === 9. http_request — DELETE ===
  console.log('\n--- 9. http_request: DELETE ---')
  const http4 = await dispatchTool('http_request', {
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    method: 'DELETE',
  }, ctx)
  assert(http4.ok === true, 'http_request DELETE succeeds')
  assert(http4.result.includes('Status: 2'), 'HTTP 2xx status')

  // === 10. http_request — custom headers ===
  console.log('\n--- 10. http_request: custom headers ===')
  const http5 = await dispatchTool('http_request', {
    url: 'https://jsonplaceholder.typicode.com/posts/1',
    method: 'GET',
    headers: { 'X-Custom-Header': 'Agent007-Test-123' },
  }, ctx)
  assert(http5.ok === true, 'http_request with custom headers succeeds')
  assert(http5.result.includes('Status: 200'), 'HTTP 200 status')

  // === 11. http_request — invalid URL ===
  console.log('\n--- 11. http_request: invalid URL ---')
  const http6 = await dispatchTool('http_request', { url: 'not-a-url' }, ctx)
  assert(http6.ok === false, 'http_request with invalid URL fails')
  assert(http6.result.includes('http:// or https://'), 'helpful error message')

  // === 12. http_request — 404 response (non-2xx) ===
  console.log('\n--- 12. http_request: 404 response ---')
  const http7 = await dispatchTool('http_request', {
    url: 'https://jsonplaceholder.typicode.com/nonexistent-endpoint-xyz',
    method: 'GET',
  }, ctx)
  assert(http7.ok === false, 'http_request 404 returns ok=false')
  assert(http7.result.includes('Status: 404'), 'status 404 in response')

  // === 13. http_request — api_key_service (without key configured — should fail gracefully) ===
  console.log('\n--- 13. http_request: api_key_service (no key configured) ---')
  const http8 = await dispatchTool('http_request', {
    url: 'https://api.openai.com/v1/models',
    method: 'GET',
    api_key_service: 'openai',
  }, ctx)
  assert(http8.ok === false, 'http_request with missing API key fails gracefully')
  assert(http8.result.includes('openai'), 'error mentions the service name')

  // === 14. http_request — unsupported method ===
  console.log('\n--- 14. http_request: unsupported method ---')
  const http9 = await dispatchTool('http_request', {
    url: 'https://example.com',
    method: 'HEAD',
  }, ctx)
  assert(http9.ok === false, 'http_request with HEAD fails')
  assert(http9.result.includes('Unsupported method'), 'helpful error message')

  // === Summary ===
  console.log(`\n${'='.repeat(60)}`)
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  console.log(`${'='.repeat(60)}`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error('Test crashed:', e); process.exit(1) })
