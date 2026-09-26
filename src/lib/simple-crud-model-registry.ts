import type { db } from './db'

// Fresh-audit fix (2026-09-26): six route.ts files under src/app/api (compliance, sentiment,
// contracts, ml-models, system-health, predictions) each independently pasted the identical
// route-slug -> Prisma-model ternary, hidden behind @ts-ignore/`(db as any)[...]`. Three of the
// six compared the WRONG string: `modelName` was `'compliance'.replace(/-/g, '')` === 'compliance',
// but the ternary only ever checked for 'compliancecheck' (and 'sentimentlog'/'contractdraft') --
// so those three routes silently fell through to the `'prediction'` default on every GET/POST/DELETE,
// reading and writing the wrong table. A single, typed source of truth makes that class of typo a
// compile error instead of a silent runtime fallthrough, and removes five more copies of the exact
// same duplicated logic.
const SIMPLE_CRUD_MODEL_BY_SLUG = {
  'system-health': 'systemHealth',
  'ml-models': 'mLModel',
  compliance: 'complianceCheck',
  sentiment: 'sentimentLog',
  contracts: 'contractDraft',
  predictions: 'prediction',
} as const satisfies Record<string, keyof typeof db>

export type SimpleCrudRouteSlug = keyof typeof SIMPLE_CRUD_MODEL_BY_SLUG

export function simpleCrudModelFor<S extends SimpleCrudRouteSlug>(slug: S): (typeof SIMPLE_CRUD_MODEL_BY_SLUG)[S] {
  return SIMPLE_CRUD_MODEL_BY_SLUG[slug]
}
