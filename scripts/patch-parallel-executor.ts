/**
 * Add parallel_executor to all agents missing it (Recommendation #3)
 */
import { readFileSync, writeFileSync } from 'fs'

const FILE = '/home/z/my-project/src/lib/subagents.ts'
const src = readFileSync(FILE, 'utf8')

const allowedToolsRegex = /allowedTools:\s*\[([^\]]+)\]/g
let patchCount = 0

const patched = src.replace(allowedToolsRegex, (match, toolsContent) => {
  if (toolsContent.includes('...')) return match
  if (match.includes('parallel_executor')) return match

  const existingTools = toolsContent
    .split(',')
    .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  const newTools = [...existingTools, 'parallel_executor']
  patchCount++
  const newContent = newTools.map(t => `'${t}'`).join(',')
  return `allowedTools: [${newContent}]`
})

writeFileSync(FILE, patched)
console.log(`✓ Added parallel_executor to ${patchCount} agents`)
