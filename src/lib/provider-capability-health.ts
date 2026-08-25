import { discoverProviderModels } from './provider-intelligence'
import { getCapabilityRuntimeState, listCapabilityRuntimeStates, setCapabilityProbeResult } from './capability-runtime-state'

export async function probeLlmCapabilities(forceRefresh = false) {
  const results = await discoverProviderModels(forceRefresh)
  return results.map((result) => {
    const state = setCapabilityProbeResult(`llm:${result.name}`, {
      ok: result.discovered,
      details: result.discovered
        ? `${result.model ?? 'model discovered'} via ${result.source ?? 'runtime probe'}`
        : result.error ?? 'Provider probe did not discover a usable model.',
    })
    return { ...result, state }
  })
}

export function getLlmCapabilityStates() {
  return listCapabilityRuntimeStates().filter((state) => state.id.startsWith('llm:'))
}

export function getLlmCapabilityState(provider: string) {
  return getCapabilityRuntimeState(`llm:${provider}`)
}
