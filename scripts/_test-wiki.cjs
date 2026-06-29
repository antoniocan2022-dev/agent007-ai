const { PrismaClient } = require('@prisma/client')
async function main() {
  const { toolWikipediaSearch, toolFreeApisDirectory } = require('/home/z/my-project/.next/server/chunks/_lib_tools_ts.js')
  console.log('wiki:', Object.keys({ toolWikipediaSearch, toolFreeApisDirectory }))
}
main().catch(e => console.error(e))
