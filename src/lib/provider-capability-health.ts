import { discoverProviderModels } from './provider-intelligence'
import { getCapabilityRuntimeState, listCapabilityRuntimeStates } from './capability-runtime-state'
import { registerCapabilityProbe, runCapabilityProbe } from './capability-probe'

const PROVIDERS = ['groq', 'zai', 'mistral', 'gemini', 'cerebras'] as const
let registered = false

function ensureRegistered() {
  if (registered) return
  registered = true
  for (const provider of PROVIDERS) {
    registerCapabilityProbe({
      id: `llm:${provider}`,
      async probe() {
        const results = await discoverProviderModels(true)
        const result = results.find((item) => item.name === provider)
        if (!result) return { ok: false, details: `Provider probe returned no result for ${provider}.`, proofLevel: 'CONNECTIVITY' }
        return {
          ok: result.discovered,
          details: result.discovered ? `${result.model ?? 'model discovered'} via ${result.source ?? 'runtime probe'}` : result.error ?? 'Provider probe did not discover a usable model.',
          proofLevel: result.discovered ? 'EXECUTION_VALIDATED' : 'CONNECTIVITY',
        }
      },
    })
  }
}

export async function probeLlmCapabilities(forceRefresh = false) {
  ensureRegistered()
  const results: Array<{ provider: string; state: Awaited<ReturnType<typeof runCapabilityProbe>> }> = []
  for (const provider of PROVIDERS) {
    if (!forceRefresh) {
      const state = getCapabilityRuntimeState(`llm:${provider}`)
      if (state.probedAt !== null) {
        results.push({ provider, state })
        continue
      }
    }
    results.push({ provider, state: await runCapabilityProbe(`llm:${provider}`, { forceRefresh }) })
  }
  return results
}

export function getLlmCapabilityStates() {
  ensureRegistered()
  return listCapabilityRuntimeStates().filter((state) => state.id.startsWith('llm:'))
}

export function getLlmCapabilityState(provider: string) {
  ensureRegistered()
  return getCapabilityRuntimeState(`llm:${provider}`)
}
