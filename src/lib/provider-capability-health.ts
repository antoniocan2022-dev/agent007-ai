import { discoverProviderModels } from './provider-intelligence'
import { getCapabilityRuntimeStatePersistent, listCapabilityRuntimeStatesPersistent } from './capability-runtime-state'
import { registerCapabilityProbe, runCapabilityProbe } from './capability-probe'

const PROVIDERS = ['groq', 'zai', 'mistral', 'gemini', 'cerebras'] as const
let registered = false
let latestResults = new Map<string, { discovered: boolean; model: string | null; source?: string; error?: string }>()

function ensureRegistered() {
  if (registered) return
  registered = true
  for (const provider of PROVIDERS) {
    registerCapabilityProbe({
      id: `llm:${provider}`,
      async probe() {
        const result = latestResults.get(provider)
        if (!result) return { ok: false, details: `No coordinated provider probe result is available for ${provider}.`, proofLevel: 'CONNECTIVITY' }
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
  const discovered = await discoverProviderModels(forceRefresh)
  latestResults = new Map(discovered.map((result) => [result.name, result]))
  return Promise.all(PROVIDERS.map(async (provider) => ({ provider, state: await runCapabilityProbe(`llm:${provider}`, { forceRefresh }) })))
}

export async function getLlmCapabilityStates() {
  ensureRegistered()
  return (await listCapabilityRuntimeStatesPersistent()).filter((state) => state.id.startsWith('llm:'))
}

export async function getLlmCapabilityState(provider: string) {
  ensureRegistered()
  return getCapabilityRuntimeStatePersistent(`llm:${provider}`)
}
