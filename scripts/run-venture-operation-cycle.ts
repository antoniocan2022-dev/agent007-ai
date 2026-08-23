import { runVentureOperationCycle } from '../src/lib/venture-operation-loop'

// Canonical scheduled heartbeat. VentureOperationCycle enters Autonomy Manager
// once; Mission Supervisor is executed as a child of the same manager lease.
const ventureId = process.env.VENTURE_ID?.trim() || 'venture_001'
const owner = process.env.VENTURE_OWNER?.trim() || 'agent007-24x7'

const result = await runVentureOperationCycle(ventureId, owner)
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exit(1)
