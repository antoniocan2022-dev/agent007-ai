/* eslint-disable */
/**
 * One-off migration: any Memory row whose `value` parses as a JSON object/array
 * (i.e. it was accidentally stored as a JS object stringified by Prisma, or whose
 * string form is "[object Object]") gets re-stringified to a proper JSON string
 * so the right-sidebar MEMORY BANK panel no longer renders "[object Object]".
 *
 * Run: `bun run scripts/fix-memory-objects.cjs` or `node scripts/fix-memory-objects.cjs`
 */
const { PrismaClient } = require('@prisma/client')

async function main() {
  const db = new PrismaClient()
  let scanned = 0
  let fixed = 0
  let skipped = 0
  const fixes = []

  try {
    const memories = await db.memory.findMany()
    scanned = memories.length
    console.log(`[fix-memory-objects] Scanning ${scanned} memory rows...`)

    for (const m of memories) {
      const v = m.value
      if (typeof v !== 'string') {
        // Prisma returns string for SQLite TEXT, but defensive anyway
        const newVal = safeStringify(v)
        await db.memory.update({ where: { id: m.id }, data: { value: newVal } })
        fixed++
        fixes.push({ id: m.id, key: m.key, before: v, after: newVal })
        continue
      }
      // Detect literal "[object Object]" anywhere in the string
      if (v.includes('[object Object]')) {
        // Try to salvage via JSON.parse first (in case it's actually valid JSON that contains
        // the substring "[object Object]"); otherwise, just sanitize.
        const salvaged = v.replace(/\[object Object\]/g, '{}')
        await db.memory.update({ where: { id: m.id }, data: { value: salvaged } })
        fixed++
        fixes.push({ id: m.id, key: m.key, before: v, after: salvaged })
        continue
      }
      // Detect values that look like JSON object/array — re-stringify with pretty-print
      const trimmed = v.trim()
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed === 'object' && parsed !== null) {
            // It's a real JSON object/array. Keep it as JSON string (canonical form).
            const canonical = JSON.stringify(parsed)
            if (canonical !== v) {
              await db.memory.update({ where: { id: m.id }, data: { value: canonical } })
              fixed++
              fixes.push({ id: m.id, key: m.key, before: v, after: canonical })
              continue
            }
          }
        } catch {
          // Not valid JSON — leave alone
        }
      }
      skipped++
    }

    console.log(`[fix-memory-objects] Done. scanned=${scanned}, fixed=${fixed}, skipped=${skipped}`)
    if (fixes.length) {
      console.log('[fix-memory-objects] Sample fixes (first 10):')
      for (const f of fixes.slice(0, 10)) {
        console.log(`  - key="${f.key}" id=${f.id}`)
        console.log(`      before: ${String(f.before).slice(0, 200)}`)
        console.log(`      after:  ${String(f.after).slice(0, 200)}`)
      }
    }
  } catch (e) {
    console.error('[fix-memory-objects] FAILED:', e)
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

function safeStringify(v) {
  try {
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

main()
