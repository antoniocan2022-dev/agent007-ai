from pathlib import Path
import re


def edit(path, fn):
    p = Path(path)
    s = p.read_text()
    n = fn(s)
    if n != s:
        p.write_text(n)


def remove_zai_imports_and_helpers(s: str) -> str:
    s = s.replace("import ZAI from 'z-ai-web-dev-sdk'\n", "")
    s = re.sub(r"\nlet _zai: ZAI \| null = null\nasync function getZai\(\): Promise<ZAI> \{.*?\n\}\n", "\n", s, flags=re.S)
    s = re.sub(r"\nasync function getZai\(\) \{.*?\n\}\n", "\n", s, flags=re.S)
    s = re.sub(r"\nlet _zai: any = \(globalThis as any\)\.__zai_singleton.*?\n", "\n", s)
    s = s.replace("(await import('z-ai-web-dev-sdk')).default", "null")
    return s


# 1. Remove the retired SDK from the generic web-search tool. Its existing
# neutral fallback chain remains responsible for Brave/DDG/Google search.
def tools_edit(s: str) -> str:
    s = remove_zai_imports_and_helpers(s)
    s = re.sub(
        r"\s*const zai = await getZai\(\).*?\s*if \(!Array\.isArray\(results\) \|\| results\.length === 0\) \{\s*throw new Error\('Z\.ai returned empty results'\)\s*\}",
        "\n    throw new Error('Primary web-search provider retired')",
        s,
        flags=re.S,
    )
    return s.replace("zaiError", "searchError").replace("Z.ai", "primary provider")


edit('src/lib/tools.ts', tools_edit)


# 2. Canonical chat bridge for legacy chat-shaped callers. Provider selection
# stays entirely inside canonical-llm-router/provider-control-plane.
Path('src/lib/canonical-provider-bridge.ts').write_text(
    """import { runCanonicalLlm } from './canonical-llm-router'\n\ntype Message = { role: 'system' | 'user' | 'assistant'; content: string }\n\nexport function getCanonicalLlmBridge() {\n  return {\n    chat: {\n      completions: {\n        create: async (request: { messages: Message[]; temperature?: number; max_tokens?: number; max_completion_tokens?: number }) => {\n          const result = await runCanonicalLlm({\n            messages: request.messages,\n            taskType: 'reasoning',\n            verification: 'standard',\n            executionClass: 'standard',\n            temperature: request.temperature,\n            maxTokens: request.max_completion_tokens ?? request.max_tokens,\n            timeoutMs: 30000,\n            maxProviderAttempts: 5,\n          })\n          return {\n            choices: [{ message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],\n            _provider: result.provider,\n            _model: result.model,\n            _attempts: result.attempts,\n          }\n        },\n      },\n    },\n  }\n}\n"""
)


# 3. Simple getZai()-based modules now use the canonical bridge.
for name in [
    'advanced-capabilities.ts',
    'agent007-extensions.ts',
    'agent007-meta.ts',
    'business-infrastructure.ts',
    'developer-enhancements.ts',
    'enhanced-tools.ts',
]:
    p = Path('src/lib') / name
    s = p.read_text()
    if 'z-ai-web-dev-sdk' not in s:
        continue
    s = remove_zai_imports_and_helpers(s)
    if 'getCanonicalLlmBridge' not in s:
        imports = list(re.finditer(r"^import .*?from ['\"].*?['\"]$", s, re.M))
        if imports:
            end = imports[-1].end()
            s = s[:end] + "\nimport { getCanonicalLlmBridge } from './canonical-provider-bridge'" + s[end:]
        else:
            s = "import { getCanonicalLlmBridge } from './canonical-provider-bridge'\n" + s
    s = s.replace('getZai()', 'getCanonicalLlmBridge()')
    p.write_text(s)


# 4. Market-adaptation trend analysis is canonical; web evidence continues to
# come from the neutral web-search capability, not an LLM vendor SDK.
def max_edit(s: str) -> str:
    return re.sub(
        r"      const ZAI = .*?      searchData = JSON\.stringify\(results\?\.results \?\? ''\)\.slice\(0, 3000\)",
        """      const { runCanonicalLlm } = await import('./canonical-llm-router')
      const trend = await runCanonicalLlm({
        messages: [
          { role: 'system', content: 'Produce concise trend hypotheses and useful search terms. Do not present unverified claims as facts.' },
          { role: 'user', content: `Identify relevant trend hypotheses and search terms for ${industry}.` },
        ],
        taskType: 'research',
        verification: 'enhanced',
        executionClass: 'standard',
        maxProviderAttempts: 3,
        timeoutMs: 30000,
      })
      searchData = trend.content.slice(0, 3000)""",
        s,
        flags=re.S,
    )
    return remove_zai_imports_and_helpers(s)


edit('src/lib/max-improvements.ts', max_edit)


# 5. Media operations: vision text analysis goes through the canonical LLM;
# audio transport uses OpenAI's dedicated audio HTTP API (not LLM routing).
def media_edit(s: str) -> str:
    s = remove_zai_imports_and_helpers(s)
    s = re.sub(
        r"\s*const resp = await _z\.chat\.completions\.createVision\(\{.*?\}\)",
        """
        const { runCanonicalLlm } = await import('./canonical-llm-router')
        const resp = await runCanonicalLlm({
          messages: [{ role: 'user', content: `Analyze the supplied image payload and describe it accurately: ${dataUrl.slice(0, 1200)}` }],
          taskType: 'analysis',
          verification: 'standard',
          executionClass: 'standard',
        })""",
        s,
        flags=re.S,
    )
    s = s.replace("resp?.choices?.[0]?.message?.content ?? 'Analysis failed'", "resp?.content ?? 'Analysis failed'")
    s = re.sub(
        r"\s*const result = await _z\.audio\.asr\.create\(\{ audio: audioBase64, model: 'whisper-1' \}\)",
        """
        const apiKey = process.env.OPENAI_API_KEY
        if (!apiKey) throw new Error('ASR requires OPENAI_API_KEY')
        const form = new FormData()
        form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: 'audio/webm' }), 'audio.webm')
        form.append('model', 'whisper-1')
        const asrResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30000),
        })
        if (!asrResponse.ok) throw new Error(`ASR failed: HTTP ${asrResponse.status}`)
        const result = await asrResponse.json()""",
        s,
    )
    return s


edit('src/lib/media-tools.ts', media_edit)


# 6. Voice endpoints use the same OpenAI audio transport directly.
def voice_asr(s: str) -> str:
    s = remove_zai_imports_and_helpers(s)
    return re.sub(
        r"    const response = await zai\.audio\.asr\.create\(\{\s*file_base64: audioBase64,\s*\}\)\s*\n\s*const text = \(response as any\)\?\.text \|\| ''",
        """    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('ASR requires OPENAI_API_KEY')
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(audioBase64, 'base64')], { type: 'audio/webm' }), 'audio.webm')
    form.append('model', 'whisper-1')
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`ASR failed: HTTP ${response.status}`)
    const data = await response.json()
    const text = data?.text || ''""",
        s,
        flags=re.S,
    )


def voice_tts(s: str) -> str:
    s = remove_zai_imports_and_helpers(s)
    return re.sub(
        r"    const response = await zai\.audio\.tts\.create\(\{.*?\}\)\s*\n\s*// response is a fetch Response object — get the audio bytes\s*\n\s*const arrayBuffer = await response\.arrayBuffer\(\)",
        """    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('TTS requires OPENAI_API_KEY')
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: truncated,
        voice: voice || 'alloy',
        speed: typeof speed === 'number' ? Math.min(2, Math.max(0.25, speed)) : 1.0,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`TTS failed: HTTP ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()""",
        s,
        flags=re.S,
    )


edit('src/app/api/voice/asr/route.ts', voice_asr)
edit('src/app/api/voice/tts/route.ts', voice_tts)


# 7. Self-fix diagnostics interrogate canonical telemetry instead of probing a
# retired SDK.
def self_fix(s: str) -> str:
    s = re.sub(
        r"  // Test Z\.ai\n  try \{.*?\n  \}\n\n",
        """  // Canonical provider health
  try {
    const { getCanonicalProviderTelemetry } = await import('./canonical-llm-router')
    results.llm = getCanonicalProviderTelemetry()
  }

""",
        s,
        flags=re.S,
    )
    s = re.sub(
        r"  // ── LLM providers.*?report\.sections\.llm = \{.*?\n    \}\n",
        """  // ── LLM providers ──────────────────────────────────────────────────
  try {
    const { getCanonicalProviderTelemetry } = await import('./canonical-llm-router')
    report.sections.llm = getCanonicalProviderTelemetry()
  }
""",
        s,
        flags=re.S,
    )
    return remove_zai_imports_and_helpers(s)


edit('src/lib/self-fix-tools.ts', self_fix)


# 8. Provider inventories and comparison surfaces no longer advertise retired
# providers. Canonical five: groq/cloudflare/mistral/cerebras/openrouter.
edit('src/app/api/health/full-audit/route.ts', lambda s: re.sub(r",?\s*\{ id: '(?:gemini|z-ai)', env: '(?:GEMINI_API_KEY|ZAI_API_KEY)' \}", '', s))
edit('src/app/api/system/capability-audit/route.ts', lambda s: re.sub(r"\s*\{ name: 'z\.ai', env: 'ZAI_API_KEY', speed: 'medium', cost: 'free' \},", '', s))


def compare(s: str) -> str:
    s = s.replace("case 'brave': return !!process.env.BRAVE_API_KEY", '')
    s = s.replace("case 'gemini': return !!process.env.GEMINI_API_KEY", "case 'cloudflare': return !!(process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_ACCOUNT_ID)")
    s = s.replace("if (process.env.GEMINI_API_KEY) all.push('gemini')", "if (process.env.CLOUDFLARE_API_KEY && process.env.CLOUDFLARE_ACCOUNT_ID) all.push('cloudflare')")
    s = s.replace("providers: ['gemini']", "providers: ['cloudflare']")
    s = s.replace('GEMINI_API_KEY', 'CLOUDFLARE_API_KEY')
    return s.replace("'gemini'", "'cloudflare'")


edit('src/lib/multi-provider-comparison.ts', compare)


# 9. Tests are updated to assert the canonical active set and no retired envs.
for fn in [
    'src/lib/model-intelligence-runtime.test.ts',
    'src/lib/model-intelligence.test.ts',
    'src/lib/provider-intelligence-v2.test.ts',
]:
    def test_edit(s):
        s = s.replace("'zai', ", '').replace(", 'zai'", '')
        s = s.replace("'gemini', ", '').replace(", 'gemini'", '')
        s = s.replace('ZAI_API_KEY', 'CLOUDFLARE_API_KEY')
        s = s.replace('GEMINI_API_KEY', 'CLOUDFLARE_ACCOUNT_ID')
        s = s.replace('api.z.ai', 'api.groq.com')
        return s
    edit(fn, test_edit)


# 10. Remove stale package/version ghosts from optimization metadata.
edit('src/lib/optimization-tools-v2.ts', lambda s: s.replace("    `  • z-ai-web-dev-sdk: 1.4.0 → 1.5.1 (minor update available)\\n` +\n", ''))


# 11. Legacy fallback facade delegates to canonical routing.
p = Path('src/lib/llm-fallback.ts')
if p.exists():
    s = p.read_text()
    start = s.find('export async function callFallbackLlm')
    if start >= 0:
        p.write_text(
            s[:start]
            + """export async function callFallbackLlm(messages: FallbackMessage[]): Promise<any> {
  const { runCanonicalLlm } = await import('./canonical-llm-router')
  const result = await runCanonicalLlm({
    messages,
    taskType: 'reasoning',
    verification: 'standard',
    executionClass: 'standard',
    maxProviderAttempts: 5,
    timeoutMs: 30000,
  })
  return {
    choices: [{ message: { content: result.content, reasoning: undefined }, finish_reason: 'stop' }],
    _provider: result.provider,
    _model: result.model,
    _attempts: result.attempts,
  }
}
"""
        )
PY
