import { authorityLevelFor } from '../src/lib/architecture-control-plane'
import {
  COMMERCIAL_ORGANIZATION,
  commercialBusinessIds,
  leadersForBusiness,
  validateCommercialOrganization,
} from '../src/lib/commercial-organization'
import { businessKeyForVenture, leaderBusinesses, sharedLeaders, ventureSpecificLeaders } from '../src/lib/commercial-organization-scope'

const errors: string[] = []
const exists = async (path: string) => Bun.file(path).exists()

function assert(condition: boolean, message: string) {
  if (!condition) errors.push(message)
}

async function main() {
  // Definition: the canonical graph is internally valid and every node has a load-bearing authority level.
  const definitionErrors = validateCommercialOrganization()
  errors.push(...definitionErrors.map((error) => `Definition: ${error}`))
  for (const node of COMMERCIAL_ORGANIZATION) {
    assert(authorityLevelFor(node.id) === node.level, `Enforcement divergence: ${node.id} resolves to ${authorityLevelFor(node.id)} instead of ${node.level}.`)
    assert(leaderBusinesses(node.id).every((business) => business === business.trim().toLowerCase()), `Definition: ${node.id} has non-canonical business scope.`)
  }

  // Ownership: each commercial business has a canonical leader and the organization never guesses a venture scope.
  for (const business of commercialBusinessIds()) {
    assert(leadersForBusiness(business).length > 0, `Ownership: business ${business} has no commercial leader.`)
    assert(ventureSpecificLeaders(business).length <= 1, `Ownership: business ${business} has multiple dedicated operational owners.`)
    assert(sharedLeaders(business).every((leader) => leader.businesses.length > 1), `Ownership: shared-leader classification drifted for ${business}.`)
  }

  // Consumption: the actual Venture OS boundary must consume the canonical scope module.
  const operationLoop = await Bun.file('src/lib/venture-operation-loop.ts').text()
  assert(operationLoop.includes("from './commercial-organization-scope'"), 'Consumption: Venture operation loop does not consume canonical organization scope.')
  assert(operationLoop.includes('resolveVentureOrganizationScope'), 'Consumption: Venture operation loop does not resolve venture organization scope.')

  // Duplicate-registry guard: authorization must not reintroduce independent leader/specialist arrays.
  const controlPlane = await Bun.file('src/lib/architecture-control-plane.ts').text()
  assert(!/const\s+LEADERS\s*=/.test(controlPlane), 'Enforcement: duplicate LEADERS registry detected in architecture-control-plane.ts.')
  assert(!/const\s+SPECIALISTS\s*=/.test(controlPlane), 'Enforcement: duplicate SPECIALISTS registry detected in architecture-control-plane.ts.')

  // Verification: the organization graph, runtime adapter, test suite, and audit script must all exist.
  assert(await exists('src/lib/commercial-organization.ts'), 'Verification: canonical organization graph is missing.')
  assert(await exists('src/lib/commercial-organization-scope.ts'), 'Verification: canonical venture-scope adapter is missing.')
  assert(await exists('tests/architecture-control-plane.test.ts'), 'Verification: architecture control-plane test is missing.')
  assert(await exists('scripts/organization-architecture-audit.ts'), 'Verification: five-layer organization audit is missing.')

  // Relational scope check is explicitly exercised for real venture IDs by integration tests; the audit only verifies the function is callable.
  assert(typeof businessKeyForVenture === 'function', 'Ownership: venture → BusinessUnit scope resolver is unavailable.')

  const uniqueErrors = [...new Set(errors)]
  if (uniqueErrors.length) {
    for (const error of uniqueErrors) console.error(error)
    process.exit(1)
  }
  console.log('Organization architecture audit passed: Definition → Ownership → Enforcement → Consumption → Verification.')
}

await main()
