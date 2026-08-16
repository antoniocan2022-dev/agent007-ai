from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        return
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected one occurrence, found {text.count(old)}')
    write(path, text.replace(old, new))

# Security: diagnostics never expose key fingerprints or lengths.
replace_once('src/app/api/health/full-audit/route.ts',
             "return key ? `(configured, len=${key.length})` : '(not set)'",
             "return key ? '(configured)' : '(not set)'")

# Evolution Engine consumes and returns the same canonical organizational state.
replace_once('src/app/api/system/evolution/route.ts',
             "import { generateHealthReport, computeOrganizationalIQ, getEvolutionHistory, runActiveEvolutionCycle } from '@/lib/evolution-engine'",
             "import { generateHealthReport, computeOrganizationalIQ, getEvolutionHistory, runActiveEvolutionCycle } from '@/lib/evolution-engine'\nimport { getCanonicalOrganizationalState, validateCanonicalOrganizationalState } from '@/lib/canonical-organizational-state'")
replace_once('src/app/api/system/evolution/route.ts',
             "  const cycleMode = url.searchParams.get('cycle') === 'true'",
             "  const cycleMode = url.searchParams.get('cycle') === 'true'\n  const organizationState = getCanonicalOrganizationalState()\n  const canonicalErrors = validateCanonicalOrganizationalState(organizationState)")
replace_once('src/app/api/system/evolution/route.ts',
             "    return NextResponse.json({ ok: true, ...cycle })",
             "    return NextResponse.json({ ok: canonicalErrors.length === 0, ...cycle, organizationState, canonicalCoherenceErrors: canonicalErrors })")
replace_once('src/app/api/system/evolution/route.ts',
             "    return NextResponse.json({ ok: true, count: history.length, history })",
             "    return NextResponse.json({ ok: canonicalErrors.length === 0, count: history.length, history, organizationState, canonicalCoherenceErrors: canonicalErrors })")
replace_once('src/app/api/system/evolution/route.ts',
             "    return NextResponse.json({ ok: true, ...iq })",
             "    return NextResponse.json({ ok: canonicalErrors.length === 0, ...iq, organizationState, canonicalCoherenceErrors: canonicalErrors })")
replace_once('src/app/api/system/evolution/route.ts',
             "  return NextResponse.json({ ok: true, ...report })",
             "  return NextResponse.json({ ok: canonicalErrors.length === 0, ...report, organizationState, canonicalCoherenceErrors: canonicalErrors })")

# Dashboard/Finance executive surface consumes the canonical state directly.
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "type EnterpriseValue = {",
             "type OrganizationalState = {\n  stateVersion?: string\n  agents?: { totalGovernedProfiles?: number }\n  providers?: { defaultPriority?: string[]; configured?: string[]; parallelLimit?: number }\n  cronPolicy?: { enabled?: boolean }\n}\n\ntype EnterpriseValue = {")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "  const [enterpriseValue, setEnterpriseValue] = useState<EnterpriseValue | null>(null)",
             "  const [enterpriseValue, setEnterpriseValue] = useState<EnterpriseValue | null>(null)\n  const [organizationState, setOrganizationState] = useState<OrganizationalState | null>(null)")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "      const [realityResponse, valueResponse] = await Promise.all([",
             "      const [realityResponse, valueResponse, organizationResponse] = await Promise.all([")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "        fetch('/api/system/portfolio?value=true', { cache: 'no-store' }),",
             "        fetch('/api/system/portfolio?value=true', { cache: 'no-store' }),\n        fetch('/api/system/canonical-state', { cache: 'no-store' }),")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "      if (!realityResponse.ok || !valueResponse.ok) {",
             "      if (!realityResponse.ok || !valueResponse.ok || !organizationResponse.ok) {")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "      const [realityData, valueData] = await Promise.all([",
             "      const [realityData, valueData, organizationData] = await Promise.all([")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "        valueResponse.json(),\n      ])",
             "        valueResponse.json(),\n        organizationResponse.json(),\n      ])")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "      setEnterpriseValue(valueData && typeof valueData === 'object' ? valueData : null)",
             "      setEnterpriseValue(valueData && typeof valueData === 'object' ? valueData : null)\n      setOrganizationState(organizationData?.state && typeof organizationData.state === 'object' ? organizationData.state : null)")
replace_once('src/components/agent/tabs/finance-executive-tab.tsx',
             "      <div className=\"rounded-xl border border-cyan-400/10 bg-cyan-400/[0.03] p-3 text-[11px] text-[#7181aa] flex gap-2\"><Activity className=\"w-3.5 h-3.5 text-cyan-300 shrink-0\" /> Live source: existing Reality Check and Portfolio APIs. {updatedAt ? `Last updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}</div>",
             "      <div className=\"rounded-xl border border-cyan-400/10 bg-cyan-400/[0.03] p-3 text-[11px] text-[#7181aa] space-y-2\"><div className=\"flex gap-2\"><Activity className=\"w-3.5 h-3.5 text-cyan-300 shrink-0\" /> Live source: Reality Check + Portfolio + Canonical Organizational State. {updatedAt ? `Last updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}</div><div>State {organizationState?.stateVersion ?? '—'} · {organizationState?.agents?.totalGovernedProfiles ?? '—'} governed leaders · Provider order: {(organizationState?.providers?.defaultPriority ?? []).join(' → ') || '—'} · Parallel limit: {organizationState?.providers?.parallelLimit ?? '—'} · Cron enabled: {organizationState?.cronPolicy?.enabled ? 'yes' : 'no'}</div></div>")

# Shared subagent protocol: Provider Intelligence 2.0 is explicit and all governed subagents
# inherit it via SHARED_MAX_PERFORMANCE_PROTOCOL.
replace_once('src/lib/subagent-max-performance.ts',
             "export const SHARED_MAX_PERFORMANCE_PROTOCOL = `",
             "export const SHARED_MAX_PERFORMANCE_PROTOCOL = `\nPROVIDER INTELLIGENCE 2.0 (MANDATORY FOR EVERY GOVERNED SUBAGENT):\n   • Default provider priority: Groq → OpenAI → Z.ai → Mistral.\n   • Secondary governed providers: OpenRouter → Gemini → Brave → Cerebras.\n   • Choose the best-fit provider for the task using task type, risk, evidence needs, latency, capabilities, and availability.\n   • You may call 2+ providers in parallel through Provider Intelligence 2.0 when independent verification, comparison, resilience, web-grounding, or diverse reasoning improves quality.\n   • Never force every task through every provider; deliberate selection is required.\n   • VID Director and CEO_AGENT007 use the same provider policy and canonical organizational state.\n")
replace_once('src/lib/subagent-max-performance.ts',
             "J. MULTI-PROVIDER LLM ROUTER (UPGRADE #82 — you run on 5 providers):",
             "J. MULTI-PROVIDER LLM ROUTER (UPGRADE #82 + PROVIDER INTELLIGENCE 2.0 — 8 governed providers):")
replace_once('src/lib/subagent-max-performance.ts',
             "   You run on a 5-provider LLM router that auto-switches on failure:",
             "   You run on an 8-provider governed LLM router. The deterministic default order is Groq → OpenAI → Z.ai → Mistral, followed by OpenRouter → Gemini → Brave → Cerebras as secondary governed providers. Task-aware selection may override the simple order, and parallel execution is supported when beneficial:")

# Remove Python bytecode accidentally produced by CI from repository working tree.
for rel in ['scripts/__pycache__/apply-coherence-fixes.cpython-312.pyc']:
    p = ROOT / rel
    if p.exists():
        p.unlink()

print('final coherence pass applied')
