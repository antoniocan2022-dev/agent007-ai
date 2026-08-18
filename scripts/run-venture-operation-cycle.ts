import { runAutonomyManagerTick } from '../src/lib/autonomy/autonomy-manager'
import { runVentureOperationCycle } from '../src/lib/venture-operation-loop'

const ventureId = process.env.VENTURE_ID?.trim() || 'venture_001'
const owner = process.env.VENTURE_OWNER?.trim() || 'agent007-24x7'

const manager = await runAutonomyManagerTick({
  actorId: 'vid',
  ventureIds: [ventureId],
  maxWorkItems: 10,
})
console.log(JSON.stringify({ operation: 'autonomy_manager', ...manager }, null, 2))
if (manager.status === 'FAILED') process.exit(1)

const result = await runVentureOperationCycle(ventureId, owner)
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exit(1)
