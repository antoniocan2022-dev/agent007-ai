import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/conversations/[id]/export?format=markdown|json
 *
 * Exports a single conversation (with all messages, tool calls, thoughts,
 * and sub-agent activity) as either:
 *   - Markdown (human-readable, includes reasoning trace)
 *   - JSON (structured, for import/backup)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params
  const url = new URL(req.url)
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'markdown'

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })

  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  if (format === 'json') {
    return NextResponse.json({
      conversation: {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: conv.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          toolName: m.toolName,
          toolArgs: m.toolArgs,
          toolResult: m.toolResult,
          attachments: m.attachments,
          createdAt: m.createdAt,
        })),
      },
    })
  }

  // Markdown format
  let md = `# ${conv.title}\n\n`
  md += `> Exported from Agent007 AI on ${new Date().toISOString()}\n`
  md += `> Conversation ID: ${conv.id}\n`
  md += `> Created: ${conv.createdAt.toISOString()}\n`
  md += `> Messages: ${conv.messages.length}\n\n---\n\n`

  for (const m of conv.messages) {
    const ts = new Date(m.createdAt).toISOString()
    if (m.role === 'user') {
      md += `## User - ${ts}\n\n${m.content}\n\n`
      if (m.attachments) {
        try {
          const atts = JSON.parse(m.attachments)
          if (Array.isArray(atts) && atts.length > 0) {
            md += `**Attachments:** ${atts.map((a: any) => a.originalName).join(', ')}\n\n`
          }
        } catch {}
      }
    } else if (m.role === 'assistant') {
      md += `## Agent007 - ${ts}\n\n${m.content}\n\n`
    } else if (m.role === 'thought') {
      const isSubagent = m.content?.startsWith('[subagent:')
      md += `### ${isSubagent ? 'Sub-agent Thought' : 'Thought'} - ${ts}\n\n> ${m.content}\n\n`
    } else if (m.role === 'tool') {
      const isSubagent = m.content?.startsWith('[subagent:')
      const isDispatch = m.toolName === 'subagent_dispatch'
      const isComplete = m.toolName === 'subagent_complete'
      const isManage = m.toolName === 'manage_action'
      let label = 'Tool Call'
      if (isDispatch) label = 'Dispatch'
      if (isComplete) label = 'Sub-agent Complete'
      if (isManage) label = 'Manage Action'
      if (isSubagent) label = 'Sub-agent Tool'
      md += `### ${label} - ${ts}\n\n`
      if (m.toolName) md += `**Tool:** \`${m.toolName}\`\n\n`
      if (m.toolArgs) md += `**Args:**\n\`\`\`json\n${m.toolArgs}\n\`\`\`\n\n`
      if (m.toolResult) md += `**Result:**\n\`\`\`\n${m.toolResult.slice(0, 2000)}${m.toolResult.length > 2000 ? '\n... (truncated)' : ''}\n\`\`\`\n\n`
    }
    md += `---\n\n`
  }

  return new NextResponse(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="agent007-${conv.title.slice(0, 40).replace(/[^a-z0-9]/gi, '-')}-${conv.id.slice(-8)}.md"`,
    },
  })
}
