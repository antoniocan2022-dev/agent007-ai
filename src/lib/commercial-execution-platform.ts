export type { CommercialProviderAdapter, CommercialProviderDefinition, CommercialProviderExecutionContext, CommercialProviderExecutionResult, ExternalAction, WebhookReceipt, ProviderObservation, ProviderHealthReport, SandboxSimulation } from './commercial-execution-platform-runtime'
export type { ProviderEnvironment, ProviderCapability, ExternalActionStatus, WebhookReceiptStatus, ProviderHealthStatus, Phase6ToolId } from './commercial-execution-platform-runtime'
export { registerCommercialProvider, getCommercialProvider, listCommercialProviders, registerCommercialProviderAdapter, getCommercialProviderAdapter, listCommercialProviderAdapters, registerCommercialCredentialReference, listCommercialCredentials, transitionCommercialCredential, validateCommercialCredential, transitionExternalAction, requestExternalAction, approveExternalAction, createWebhookSignature, verifyWebhookSignature, ingestExternalWebhook, replayExternalWebhook, recordProviderObservation, getProviderHealth, listProviderHealth, simulateExternalAction, replayWebhookInSandbox, transitionCommercialWorkflow, PHASE6_TOOL_IDS, PHASE6_VERSION } from './commercial-execution-platform-runtime'

export function validatePhase6ExecutionContracts(): string[] {
  const errors: string[] = []
  const capabilities = ['read','write','send','schedule','charge','refund','publish','search','job_search']
  if (new Set(capabilities).size !== capabilities.length) errors.push('Provider capability taxonomy contains duplicates.')
  const actionStates = ['queued','preflight','awaiting_approval','authorized','dispatched','succeeded','failed','blocked','cancelled']
  if (new Set(actionStates).size !== actionStates.length) errors.push('External action state taxonomy contains duplicates.')
  return errors
}
