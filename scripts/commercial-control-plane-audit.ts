import { COMMERCIAL_BUSINESSES, COMMERCIAL_CATEGORIES, validateCommercialControlPlaneContracts } from '../src/lib/commercial-control-plane'

const errors = validateCommercialControlPlaneContracts()
const categories = Object.values(COMMERCIAL_CATEGORIES)

if (categories.length !== 10 || new Set(categories).size !== categories.length) errors.push('Commercial persistence categories are missing or duplicated.')
if (COMMERCIAL_BUSINESSES.length !== 4 || new Set(COMMERCIAL_BUSINESSES).size !== COMMERCIAL_BUSINESSES.length) errors.push('Commercial business taxonomy is missing or duplicated.')

if (errors.length) {
  console.error(`Commercial Control Plane audit FAILED:\n- ${errors.join('\n- ')}`)
  process.exit(1)
}

console.log('Commercial Control Plane audit PASSED: taxonomy, persistence categories, and contract invariants are coherent.')
