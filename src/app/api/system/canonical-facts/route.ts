import { NextResponse } from 'next/server'
import { getCanonicalSystemFacts } from '@/lib/canonical-system-facts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const facts = await getCanonicalSystemFacts()
  return NextResponse.json({
    organization: facts.organization,
    providers: facts.providers,
    capabilities: {
      knownRuntimeStates: facts.capabilities.knownRuntimeStates,
      statuses: facts.capabilities.states.map(({ id, status, probedAt }) => ({ id, status, probedAt })),
    },
  })
}
