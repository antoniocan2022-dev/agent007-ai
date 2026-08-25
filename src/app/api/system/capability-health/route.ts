import { NextRequest, NextResponse } from 'next/server'
import { getLlmCapabilityStates, probeLlmCapabilities } from '@/lib/provider-capability-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const shouldProbe = req.nextUrl.searchParams.get('probe') === 'true'
  const result = shouldProbe ? await probeLlmCapabilities(true) : null
  return NextResponse.json({
    probeRequested: shouldProbe,
    llm: result ?? getLlmCapabilityStates(),
    truthRule: 'Capability state is UNKNOWN until a real runtime probe succeeds or fails.',
  })
}
