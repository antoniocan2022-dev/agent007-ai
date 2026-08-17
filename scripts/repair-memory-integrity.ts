import { db } from '@/lib/db'
import { sanitizeMemoryFields } from '@/lib/memory-text'

type MemoryHexRow = {
  id: string
  key_hex: string
  value_hex: string
  category_hex: string
}

function decodeUtf8Hex(hex: string): string {
  return Buffer.from(hex, 'hex').toString('utf8')
}

const apply = process.argv.includes('--apply')

async function main(): Promise<void> {
  const rows = await db.$queryRaw<MemoryHexRow[]>`
    SELECT
      id,
      encode(convert_to("key", 'UTF8'), 'hex') AS key_hex,
      encode(convert_to(value, 'UTF8'), 'hex') AS value_hex,
      encode(convert_to(category, 'UTF8'), 'hex') AS category_hex
    FROM "Memory"
    ORDER BY "updatedAt" DESC
  `

  let changed = 0
  let failed = 0
  const sanitizedKeys = new Map<string, string>()
  const allOriginalKeys = new Map<string, string>()

  for (const row of rows) {
    allOriginalKeys.set(decodeUtf8Hex(row.key_hex), row.id)
  }

  for (const row of rows) {
    const original = {
      key: decodeUtf8Hex(row.key_hex),
      value: decodeUtf8Hex(row.value_hex),
      category: decodeUtf8Hex(row.category_hex),
    }
    const fields = sanitizeMemoryFields(original)
    const changedRow =
      fields.key !== original.key ||
      fields.value !== original.value ||
      fields.category !== original.category

    if (!changedRow) continue

    changed += 1
    const existingSanitized = sanitizedKeys.get(fields.key)
    const existingOriginal = allOriginalKeys.get(fields.key)
    if (
      (existingSanitized && existingSanitized !== row.id) ||
      (existingOriginal && existingOriginal !== row.id)
    ) {
      throw new Error(
        `Sanitization would create a duplicate Memory.key; conflicting rows: ${existingSanitized ?? existingOriginal} and ${row.id}`
      )
    }
    sanitizedKeys.set(fields.key, row.id)

    if (!apply) continue

    try {
      await db.$executeRaw`
        UPDATE "Memory"
        SET "key" = ${fields.key},
            value = ${fields.value},
            category = ${fields.category},
            "updatedAt" = NOW()
        WHERE id = ${row.id}
      `
    } catch (error) {
      failed += 1
      console.error(
        `[memory-integrity] failed to repair row ${row.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  console.log(
    `[memory-integrity] scanned=${rows.length} changed=${changed} repaired=${
      apply ? changed - failed : 0
    } failed=${failed} mode=${apply ? 'apply' : 'dry-run'}`
  )

  if (!apply && changed > 0) {
    console.log('[memory-integrity] Re-run with --apply to persist the sanitized rows.')
  }

  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(
      `[memory-integrity] fatal: ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
