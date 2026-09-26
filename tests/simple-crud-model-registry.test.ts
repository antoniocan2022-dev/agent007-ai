import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { simpleCrudModelFor } from '@/lib/simple-crud-model-registry'

const ROOT = join(import.meta.dir, '..')
const readSrc = (path: string) => readFileSync(join(ROOT, 'src', path), 'utf-8')

describe('Fresh audit fix (2026-09-26): simple-crud-model-registry replaces the broken per-route ternary', () => {
  test('every route slug resolves to its real Prisma model name', () => {
    expect(simpleCrudModelFor('compliance')).toBe('complianceCheck')
    expect(simpleCrudModelFor('sentiment')).toBe('sentimentLog')
    expect(simpleCrudModelFor('contracts')).toBe('contractDraft')
    expect(simpleCrudModelFor('ml-models')).toBe('mLModel')
    expect(simpleCrudModelFor('system-health')).toBe('systemHealth')
    expect(simpleCrudModelFor('predictions')).toBe('prediction')
  })

  // The original bug: modelName was 'compliance'.replace(/-/g, '') === 'compliance', but the inline
  // ternary only ever checked for 'compliancecheck' -- so it silently fell through to 'prediction' on
  // every GET/POST/DELETE. Confirms the fix by reading each route file's actual source.
  test('the three previously-broken routes (compliance, sentiment, contracts) now use the typed registry, not the old ternary', () => {
    for (const [routeDir, slug] of [['compliance', "'compliance'"], ['sentiment', "'sentiment'"], ['contracts', "'contracts'"]] as const) {
      const route = readSrc(`app/api/${routeDir}/route.ts`)
      expect(route).toContain(`simpleCrudModelFor(${slug})`)
      expect(route).not.toContain('@ts-ignore')
      expect(route).not.toContain("=== 'compliancecheck'")
    }
  })

  test('the three previously-correct routes (ml-models, system-health, predictions) also now use the typed registry', () => {
    for (const [routeDir, slug] of [['ml-models', "'ml-models'"], ['system-health', "'system-health'"], ['predictions', "'predictions'"]] as const) {
      const route = readSrc(`app/api/${routeDir}/route.ts`)
      expect(route).toContain(`simpleCrudModelFor(${slug})`)
      expect(route).not.toContain('@ts-ignore')
    }
  })
})
