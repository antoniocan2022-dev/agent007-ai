const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
async function main() {
  // Check that web_search tool calls happened with real results
  const webSearchResults = await prisma.message.findMany({
    where: { toolName: 'subagent_tool', toolArgs: { contains: '"tool":"web_search"' } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { toolArgs: true, toolResult: true, createdAt: true }
  })
  console.log(`=== Recent subagent web_search calls ===`)
  for (const r of webSearchResults) {
    let args
    try { args = JSON.parse(r.toolArgs) } catch { args = { agentId: '?', args: '{}' } }
    let innerArgs
    try { innerArgs = JSON.parse(args.args) } catch { innerArgs = {} }
    console.log(`[${r.createdAt.toISOString()}] ${args.agentId} searched: ${innerArgs.query || '(no query)'}`)
    console.log(`  Result preview: ${(r.toolResult || '').slice(0, 250)}...`)
    console.log()
  }
  
  // Check page_reader calls too
  const pageReaderResults = await prisma.message.findMany({
    where: { toolName: 'subagent_tool', toolArgs: { contains: '"tool":"page_reader"' } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { toolArgs: true, toolResult: true, createdAt: true }
  })
  console.log(`=== Recent subagent page_reader calls ===`)
  for (const r of pageReaderResults) {
    let args
    try { args = JSON.parse(r.toolArgs) } catch { args = { agentId: '?', args: '{}' } }
    let innerArgs
    try { innerArgs = JSON.parse(args.args) } catch { innerArgs = {} }
    console.log(`[${r.createdAt.toISOString()}] ${args.agentId} read URL: ${innerArgs.url || '(no url)'}`)
    console.log(`  Result preview: ${(r.toolResult || '').slice(0, 250)}...`)
    console.log()
  }
  
  // Check that the User table exists with antonio's account
  const users = await prisma.user.findMany()
  console.log(`=== Users ===`)
  for (const u of users) {
    console.log(`- ${u.email} (id: ${u.id}, hasPasswordHash: ${!!u.passwordHash}, createdAt: ${u.createdAt.toISOString()})`)
  }
}
main().finally(() => prisma.$disconnect())
