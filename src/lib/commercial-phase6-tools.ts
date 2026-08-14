import type { ToolContext, ToolResult } from './tools'
import {
  PHASE6_TOOL_IDS,
  getCommercialProvider,
  listCommercialProviderAdapters,
  listCommercialCredentials,
  listProviderHealth,
  registerCommercialProvider,
  registerCommercialProviderAdapter,
  registerCommercialCredentialReference,
  requestExternalAction,
  approveExternalAction,
  ingestExternalWebhook,
  replayExternalWebhook,
  replayWebhookInSandbox,
  simulateExternalAction,
  transitionCommercialCredential,
  validateCommercialCredential,
  transitionExternalAction,
  transitionCommercialWorkflow,
} from './commercial-execution-platform'
import type { CommercialProviderAdapter, CommercialProviderDefinition, ProviderCapability } from './commercial-execution-platform'
import type { CommercialBusiness, CredentialStatus } from './commercial-control-plane'

const ok = (preview: string, result: unknown): ToolResult => ({ ok: true, preview, result: typeof result === 'string' ? result : JSON.stringify(result, null, 2) })
const bad = (message: string): ToolResult => ({ ok: false, preview: message.slice(0, 160), result: message })
const argString = (args: any, key: string) => typeof args?.[key] === 'string' ? args[key].trim() : ''
const requireBusiness = (args: any): CommercialBusiness => {
  const business = argString(args, 'business')
  if (!['revenue-recovery', 'operations-kit', 'career-command', 'shared-platform'].includes(business)) throw new Error('Valid commercial business is required.')
  return business as CommercialBusiness
}

export async function toolPhase6ProviderRegistry(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    if (argString(args, 'mode') === 'list') return ok('Phase 6 providers listed', { adapters: listCommercialProviderAdapters() })
    const definition: Omit<CommercialProviderDefinition, 'createdAt' | 'updatedAt'> = {
      providerId: argString(args, 'providerId'),
      name: argString(args, 'name'),
      version: argString(args, 'version') || '1.0.0',
      capabilities: (Array.isArray(args?.capabilities) ? args.capabilities : ['read']).filter((x: unknown): x is ProviderCapability => typeof x === 'string') as ProviderCapability[],
      businesses: [requireBusiness(args)],
      environments: args?.environments?.includes('live') ? ['sandbox', 'live'] : ['sandbox'],
      webhookEvents: Array.isArray(args?.webhookEvents) ? args.webhookEvents.map(String) : [],
      status: args?.status === 'disabled' ? 'disabled' : 'enabled',
    }
    return ok(`Provider ${definition.providerId} registered`, await registerCommercialProvider(definition))
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6ProviderAdapter(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    if (!argString(args, 'providerId')) return bad('providerId is required.')
    const provider = await getCommercialProvider(argString(args, 'providerId'))
    return provider ? ok(`Provider ${provider.providerId} is adapter-ready`, { provider, runtimeAdapterRegistered: listCommercialProviderAdapters().includes(provider.providerId) }) : bad('Provider was not found.')
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6ExecutionRuntime(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const business = requireBusiness(args)
    if (argString(args, 'mode') === 'transition-workflow') {
      const result = await transitionCommercialWorkflow({ tenantId: argString(args, 'tenantId'), workflowId: argString(args, 'workflowId'), status: argString(args, 'status') as any, output: args?.output ?? undefined, nextRunAt: args?.nextRunAt ?? undefined, incrementRetry: Boolean(args?.incrementRetry) })
      return result ? ok('Commercial workflow transitioned', result) : bad('Commercial workflow was not found.')
    }
    const action = await transitionExternalAction({ tenantId: argString(args, 'tenantId'), actionId: argString(args, 'actionId'), status: argString(args, 'status') as any, result: args?.result ?? undefined, error: args?.error ?? undefined })
    return action ? ok(`External action ${action.status}`, action) : bad('External action was not found.')
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6CredentialLifecycle(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const tenantId = argString(args, 'tenantId')
    if (argString(args, 'mode') === 'register') {
      const result = await registerCommercialCredentialReference({ tenantId, business: requireBusiness(args), provider: argString(args, 'provider'), externalAccountId: argString(args, 'externalAccountId') || null, scopes: Array.isArray(args?.scopes) ? args.scopes.map(String) : [], secretRef: argString(args, 'secretRef'), status: 'pending' })
      return ok('Opaque credential reference registered', result)
    }
    if (argString(args, 'mode') === 'validate') return ok('Credential validation complete', await validateCommercialCredential({ tenantId, credentialId: argString(args, 'credentialId') }))
    const status = argString(args, 'status') as CredentialStatus
    return ok('Credential lifecycle state updated', await transitionCommercialCredential({ tenantId, credentialId: argString(args, 'credentialId'), status }))
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6ActionGateway(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    if (argString(args, 'mode') === 'approve') return ok('External action approved and dispatched', await approveExternalAction({ tenantId: argString(args, 'tenantId'), actionId: argString(args, 'actionId'), approvedByUserId: argString(args, 'approvedByUserId') }))
    return ok('External action request processed', await requestExternalAction({ tenantId: argString(args, 'tenantId'), business: requireBusiness(args), provider: argString(args, 'provider'), operation: argString(args, 'operation') as ProviderCapability, channel: argString(args, 'channel') || null, environment: args?.environment === 'sandbox' ? 'sandbox' : 'live', spend: Number(args?.spend ?? 0), requestedBy: argString(args, 'requestedBy'), payload: (args?.payload && typeof args.payload === 'object') ? args.payload : {}, idempotencyKey: argString(args, 'idempotencyKey'), credentialId: argString(args, 'credentialId') || null }))
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6WebhookGateway(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    return ok('Webhook ingested and processed', await ingestExternalWebhook({ tenantId: argString(args, 'tenantId'), business: requireBusiness(args), provider: argString(args, 'provider'), eventType: argString(args, 'eventType'), externalEventId: argString(args, 'externalEventId'), body: argString(args, 'body'), signature: argString(args, 'signature'), signingSecret: argString(args, 'signingSecret') }))
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6ProviderObservability(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try { return ok('Provider health report', await listProviderHealth(argString(args, 'tenantId'))) } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6SandboxMode(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try { return ok('Sandbox simulation complete', await simulateExternalAction({ tenantId: argString(args, 'tenantId'), business: requireBusiness(args), provider: argString(args, 'provider'), operation: argString(args, 'operation') as ProviderCapability, channel: argString(args, 'channel') || null, requestedBy: argString(args, 'requestedBy') || 'phase6-sandbox', spend: Number(args?.spend ?? 0), payload: (args?.payload && typeof args.payload === 'object') ? args.payload : {} })) } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export async function toolPhase6WebhookReplay(args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    if (argString(args, 'mode') === 'sandbox') return ok('Webhook replay simulated safely', await replayWebhookInSandbox({ tenantId: argString(args, 'tenantId'), receiptId: argString(args, 'receiptId') }))
    return ok('Webhook replay processed', await replayExternalWebhook({ tenantId: argString(args, 'tenantId'), receiptId: argString(args, 'receiptId') }))
  } catch (error) { return bad(error instanceof Error ? error.message : String(error)) }
}

export const COMMERCIAL_PHASE6_TOOLS = Object.freeze({
  phase6_provider_registry: toolPhase6ProviderRegistry,
  phase6_provider_adapter: toolPhase6ProviderAdapter,
  phase6_execution_runtime: toolPhase6ExecutionRuntime,
  phase6_credential_lifecycle: toolPhase6CredentialLifecycle,
  phase6_action_gateway: toolPhase6ActionGateway,
  phase6_webhook_gateway: toolPhase6WebhookGateway,
  phase6_provider_observability: toolPhase6ProviderObservability,
  phase6_sandbox_mode: toolPhase6SandboxMode,
  phase6_webhook_replay: toolPhase6WebhookReplay,
})

export { PHASE6_TOOL_IDS }
