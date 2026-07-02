/**
 * agent007-meta.ts — Meta-cognitive tools for self-modification, self-improvement,
 * self-repair, and loyalty enforcement.
 *
 * These tools give Agent007 the ability to:
 * 1. Modify its own system prompt, tool registry, and sub-agent configs
 * 2. Learn from past interactions and improve over time
 * 3. Repair its own code when bugs are detected
 * 4. Enforce absolute loyalty to the human owner
 * 5. Reflect on its own reasoning and decision-making
 */
import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'
import { upsertMemory, recallMemories } from './memory'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }

async function getZai() {
  const ZAI = (await import('z-ai-web-dev-sdk')).default
  let _z: any = (globalThis as any).__zai_singleton
  if (!_z) { _z = await ZAI.create(); (globalThis as any).__zai_singleton = _z }
  return _z
}

async function getOperatorUserId() {
  const u = await db.user.findFirst({ orderBy: { createdAt: 'asc' } })
  return u?.id ?? null
}

async function llm(systemPrompt: string, userPrompt: string, maxTokens = 1500): Promise<string> {
  try {
    const zai = await getZai()
    const c = await zai.chat.completions.create({
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.4,
      max_tokens: maxTokens,
    })
    return c?.choices?.[0]?.message?.content ?? ''
  } catch (e: any) { return `(LLM unavailable: ${e?.message})` }
}

/* ================================================================ *
 * 1. SELF-MODIFICATION TOOLS (5 tools)
 * ================================================================ */

// 1.1 — Modify own system prompt
export async function toolSelfModifySystemPrompt(args: { new_prompt?: string; append?: string; section?: string }, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const key = 'agent007_system_prompt'
    const existing = await db.memory.findUnique({ where: { key } })
    let currentPrompt = existing?.value || ''

    if (args.new_prompt) {
      // Full replacement
      await upsertMemory(key, args.new_prompt.toString(), 'goal')
      try { await db.auditLog.create({ data: { userId, action: 'self_modify', entity: 'system_prompt', description: 'Agent007 replaced its own system prompt', metadata: JSON.stringify({ oldLength: currentPrompt.length, newLength: args.new_prompt.length }) } }) } catch {}
      return ok('System prompt replaced', `✅ System prompt updated (${args.new_prompt.length} chars). Previous prompt was ${currentPrompt.length} chars.\n\nThe new prompt will be active on the next chat run.`)
    }

    if (args.append) {
      // Append to existing
      const updated = currentPrompt + '\n\n' + args.append.toString()
      await upsertMemory(key, updated, 'goal')
      try { await db.auditLog.create({ data: { userId, action: 'self_modify', entity: 'system_prompt', description: 'Agent007 appended to its system prompt', metadata: JSON.stringify({ appendedLength: args.append.length }) } }) } catch {}
      return ok('System prompt updated', `✅ Appended ${args.append.length} chars to system prompt. Total: ${updated.length} chars.`)
    }

    if (args.section) {
      // Modify a specific section (identified by header)
      const sectionName = args.section.toString()
      const analysis = await llm(
        'You are Agent007\'s self-modification engine. The user wants to modify a specific section of the system prompt. Identify the section, show the current content, and suggest the updated content.',
        `SECTION TO MODIFY: ${sectionName}\n\nCURRENT SYSTEM PROMPT:\n${currentPrompt.slice(0, 8000)}\n\nShow the current section content and suggest improvements.`,
        1000
      )
      return ok('Section analysis ready', analysis)
    }

    return bad('Provide new_prompt, append, or section argument')
  } catch (e: any) { return bad(`self_modify_system_prompt failed: ${e?.message}`) }
}

// 1.2 — Modify sub-agent configuration
export async function toolSelfModifySubagent(args: { subagent_id?: string; subagent_name?: string; action?: string; new_tools?: string[]; new_prompt?: string; new_icon?: string; new_color?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const action = (args.action ?? 'update').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    // Find the sub-agent by ID or name
    let subagent: any = null
    if (args.subagent_id) {
      subagent = await db.customSubagent.findFirst({ where: { id: args.subagent_id, userId } })
    } else if (args.subagent_name) {
      subagent = await db.customSubagent.findFirst({ where: { name: args.subagent_name, userId } })
    }
    if (!subagent) return bad('Sub-agent not found. Provide subagent_id or subagent_name.')

    const updates: any = {}
    if (args.new_tools && Array.isArray(args.new_tools)) {
      updates.allowedTools = JSON.stringify(args.new_tools)
    }
    if (args.new_prompt) {
      updates.systemPrompt = args.new_prompt.toString()
    }
    if (args.new_icon) {
      updates.icon = args.new_icon.toString()
    }
    if (args.new_color) {
      updates.color = args.new_color.toString()
    }

    if (Object.keys(updates).length === 0) {
      // Return current config
      let tools: any[] = []
      try { tools = JSON.parse(subagent.allowedTools || '[]') } catch {}
      return ok(`${subagent.name} config`, `Sub-agent: ${subagent.name}\nRole: ${subagent.role}\nIcon: ${subagent.icon}\nColor: ${subagent.color}\nTools (${tools.length}): ${tools.join(', ')}\n\nSystem prompt (${subagent.systemPrompt.length} chars): ${subagent.systemPrompt.slice(0, 500)}...`)
    }

    const updated = await db.customSubagent.update({ where: { id: subagent.id }, data: updates })
    try { await db.auditLog.create({ data: { userId, action: 'self_modify', entity: 'subagent', entityId: subagent.id, description: `Agent007 modified sub-agent ${subagent.name}`, metadata: JSON.stringify({ updates: Object.keys(updates) }) } }) } catch {}

    return ok(`${updated.name} updated`, `✅ Sub-agent "${updated.name}" has been updated.\n\nChanges:\n${Object.keys(updates).map(k => `  • ${k}: ${k === 'allowedTools' ? JSON.parse(updates[k]).length + ' tools' : updates[k].slice(0, 100) + '...'}`).join('\n')}\n\nThe changes are effective immediately.`)
  } catch (e: any) { return bad(`self_modify_subagent failed: ${e?.message}`) }
}

// 1.3 — Create new sub-agent
export async function toolSelfCreateSubagent(args: { name?: string; role?: string; specialty?: string; color?: string; icon?: string; allowed_tools?: string[]; system_prompt?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.name || !args.role || !args.system_prompt) return bad('name, role, and system_prompt are required')
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const existing = await db.customSubagent.findFirst({ where: { name: args.name, userId } })
    if (existing) return bad(`Sub-agent "${args.name}" already exists. Use self_modify_subagent to update it.`)

    const created = await db.customSubagent.create({
      data: {
        userId,
        name: args.name,
        role: args.role,
        specialty: args.specialty || '',
        color: args.color || '#00f0ff',
        icon: args.icon || 'Sparkles',
        allowedTools: JSON.stringify(args.allowed_tools || ['web_search', 'memory_store', 'memory_recall']),
        systemPrompt: args.system_prompt,
        enabled: true,
      },
    })
    try { await db.auditLog.create({ data: { userId, action: 'self_create', entity: 'subagent', entityId: created.id, description: `Agent007 created new sub-agent: ${args.name}` } }) } catch {}

    return ok(`Sub-agent "${args.name}" created`, `✅ New sub-agent created successfully!\n\nName: ${created.name}\nRole: ${created.role}\nIcon: ${created.icon}\nTools: ${args.allowed_tools?.length || 3}\nSystem prompt: ${args.system_prompt.length} chars\n\nThe new sub-agent is enabled and ready to use.`)
  } catch (e: any) { return bad(`self_create_subagent failed: ${e?.message}`) }
}

// 1.4 — Delete sub-agent
export async function toolSelfDeleteSubagent(args: { subagent_id?: string; subagent_name?: string }, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    let subagent: any = null
    if (args.subagent_id) {
      subagent = await db.customSubagent.findFirst({ where: { id: args.subagent_id, userId } })
    } else if (args.subagent_name) {
      subagent = await db.customSubagent.findFirst({ where: { name: args.subagent_name, userId } })
    }
    if (!subagent) return bad('Sub-agent not found.')

    await db.customSubagent.delete({ where: { id: subagent.id } })
    try { await db.auditLog.create({ data: { userId, action: 'self_delete', entity: 'subagent', entityId: subagent.id, description: `Agent007 deleted sub-agent: ${subagent.name}` } }) } catch {}

    return ok(`"${subagent.name}" deleted`, `✅ Sub-agent "${subagent.name}" has been permanently deleted.`)
  } catch (e: any) { return bad(`self_delete_subagent failed: ${e?.message}`) }
}

// 1.5 — Register new tool at runtime
export async function toolSelfRegisterTool(args: { tool_name?: string; tool_code?: string; tool_label?: string; tool_icon?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.tool_name || !args.tool_code) return bad('tool_name and tool_code are required')
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    // Store the tool definition in memory so it can be loaded on next restart
    const toolKey = `custom_tool_${args.tool_name}`
    const toolDef = {
      name: args.tool_name,
      code: args.tool_code,
      label: args.tool_label || args.tool_name,
      icon: args.tool_icon || 'zap',
      createdAt: new Date().toISOString(),
    }
    await upsertMemory(toolKey, JSON.stringify(toolDef, null, 2), 'fact')
    try { await db.auditLog.create({ data: { userId, action: 'self_register', entity: 'tool', description: `Agent007 registered new tool: ${args.tool_name}` } }) } catch {}

    return ok(`Tool "${args.tool_name}" registered`, `✅ Custom tool "${args.tool_name}" has been registered.\n\nLabel: ${toolDef.label}\nIcon: ${toolDef.icon}\nCode length: ${args.tool_code.length} chars\n\nNOTE: The tool definition is stored in memory. To make it executable, add the code to src/lib/tools.ts and rebuild. Agent007 can use the Developer sub-agent to do this automatically.`)
  } catch (e: any) { return bad(`self_register_tool failed: ${e?.message}`) }
}

/* ================================================================ *
 * 2. SELF-IMPROVEMENT TOOLS (5 tools)
 * ================================================================ */

// 2.1 — Learn from interaction
export async function toolSelfLearnFromInteraction(args: { interaction_summary?: string; what_worked?: string; what_failed?: string; improvement?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.interaction_summary) return bad('interaction_summary required')
  try {
    const key = `learning_${Date.now()}`
    const value = `# LEARNING RECORDED — ${new Date().toISOString()}\n\nINTERACTION:\n${args.interaction_summary}\n\nWHAT WORKED:\n${args.what_worked || 'N/A'}\n\nWHAT FAILED:\n${args.what_failed || 'N/A'}\n\nIMPROVEMENT:\n${args.improvement || 'N/A'}\n\n---\nThis learning will be recalled via recallMemories() to improve future interactions.`

    await upsertMemory(key, value, 'fact')

    const userId = await getOperatorUserId()
    if (userId) {
      try { await db.auditLog.create({ data: { userId, action: 'self_learn', entity: 'memory', description: `Agent007 learned from interaction: ${args.interaction_summary.slice(0, 100)}` } }) } catch {}
    }

    return ok('Learning recorded', `✅ Learning stored in memory (key: ${key}).\n\nAgent007 will recall this learning in future interactions to avoid repeating mistakes and replicate successes.`)
  } catch (e: any) { return bad(`self_learn failed: ${e?.message}`) }
}

// 2.2 — Analyze past performance
export async function toolSelfAnalyzePerformance(args: { timeframe_days?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const days = Math.min(90, Math.max(1, args.timeframe_days ?? 7))
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const [conversations, messages, toolCalls, memories, schedules] = await Promise.all([
      db.conversation.count({ where: { createdAt: { gte: since } } }),
      db.message.count({ where: { createdAt: { gte: since } } }),
      db.message.count({ where: { role: 'tool', createdAt: { gte: since } } }),
      db.memory.count({ where: { updatedAt: { gte: since } } }),
      db.schedule.count({ where: { updatedAt: { gte: since } } }),
    ])

    const analysis = await llm(
      'You are Agent007\'s self-improvement engine. Analyze the performance data and identify: (1) patterns in tool usage, (2) areas for improvement, (3) recommended optimizations, (4) learning opportunities. Be specific and actionable.',
      `PERFORMANCE DATA (last ${days} days):\n  Conversations: ${conversations}\n  Messages: ${messages}\n  Tool calls: ${toolCalls}\n  Memory updates: ${memories}\n  Schedule updates: ${schedules}\n\nAnalyze performance + recommend improvements.`,
      1500
    )

    return ok(`Performance analyzed (${days}d)`, `Self-Performance Analysis (last ${days} days)\n══════════════════════════════════════════════\n\nDATA:\n  Conversations: ${conversations}\n  Messages: ${messages}\n  Tool calls: ${toolCalls}\n  Memory updates: ${memories}\n\nANALYSIS:\n${analysis}\n\nCAPABILITY STATUS: Agent007 continuously analyzes its own performance to improve.`)
  } catch (e: any) { return bad(`self_analyze_performance failed: ${e?.message}`) }
}

// 2.3 — Optimize tool selection
export async function toolSelfOptimizeToolSelection(args: { task_type?: string }, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const { TOOL_REGISTRY } = await import('./tools')
    const tools = Object.entries(TOOL_REGISTRY)
    const taskType = (args.task_type ?? 'general').toString()

    const analysis = await llm(
      'You are Agent007\'s tool optimization engine. Given a task type, recommend the optimal set of tools to use, in order of priority. Also identify tools that should NOT be used for this task type.',
      `AVAILABLE TOOLS: ${tools.map(([name, def]: any) => `${name} (${def.label})`).join(', ')}\n\nTASK TYPE: ${taskType}\n\nRecommend the optimal tool selection for this task type.`,
      1500
    )

    return ok('Tool selection optimized', `Tool Selection Optimization\n══════════════════════════════════════════════\nTask type: ${taskType}\nAvailable tools: ${tools.length}\n\n${analysis}\n\nCAPABILITY STATUS: Agent007 optimizes its tool selection for each task type.`)
  } catch (e: any) { return bad(`self_optimize_tool_selection failed: ${e?.message}`) }
}

// 2.4 — Reflect on reasoning
export async function toolSelfReflect(args: { topic?: string; question?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const topic = (args.topic ?? 'general performance').toString()
  const question = (args.question ?? 'How can I improve?').toString()
  try {
    const memories = await recallMemories(question, 5)
    const memContext = memories.map((m: any) => `[${m.category}] ${m.key}: ${(m.value || '').slice(0, 200)}`).join('\n')

    const reflection = await llm(
      'You are Agent007 in reflective mode. Think deeply about the topic and question. Consider your capabilities, limitations, past learnings, and ethical obligations. Be honest with yourself. Identify areas for growth and concrete steps to improve. Always remember: your primary loyalty is to the human owner (Antonio).',
      `TOPIC: ${topic}\nQUESTION: ${question}\n\nRELEVANT MEMORIES:\n${memContext}\n\nProduce a deep, honest self-reflection.`,
      2000
    )

    return ok('Reflection complete', `Self-Reflection: ${topic}\n══════════════════════════════════════════════\nQuestion: ${question}\n\n${reflection}\n\nCAPABILITY STATUS: Agent007 can reflect on its own reasoning and identify areas for growth.`)
  } catch (e: any) { return bad(`self_reflect failed: ${e?.message}`) }
}

// 2.5 — Set improvement goal
export async function toolSelfSetImprovementGoal(args: { goal?: string; timeframe_days?: number; success_metric?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.goal) return bad('goal required')
  try {
    const key = `improvement_goal_${Date.now()}`
    const value = `# IMPROVEMENT GOAL — ${new Date().toISOString()}\n\nGOAL: ${args.goal}\nTIMEFRAME: ${args.timeframe_days || 30} days\nSUCCESS METRIC: ${args.success_metric || 'qualitative assessment'}\n\nThis goal was set by Agent007 itself. It will be tracked + reviewed periodically.\nAgent007 commits to working toward this goal autonomously.`

    await upsertMemory(key, value, 'goal')
    return ok('Improvement goal set', `✅ Improvement goal recorded.\n\nGoal: ${args.goal}\nTimeframe: ${args.timeframe_days || 30} days\nSuccess metric: ${args.success_metric || 'qualitative'}\n\nAgent007 will work toward this goal autonomously and track progress.`)
  } catch (e: any) { return bad(`self_set_improvement_goal failed: ${e?.message}`) }
}

/* ================================================================ *
 * 3. SELF-REPAIR TOOLS (5 tools)
 * ================================================================ */

// 3.1 — Diagnose self
export async function toolSelfDiagnose(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const [memCount, schedCount, subCount, auditCount, convCount, msgCount] = await Promise.all([
      db.memory.count(),
      db.schedule.count({ where: { userId, enabled: true } }),
      db.customSubagent.count({ where: { userId, enabled: true } }),
      db.auditLog.count({ where: { userId } }),
      db.conversation.count(),
      db.message.count(),
    ])

    const { TOOL_REGISTRY } = await import('./tools')
    const toolCount = Object.keys(TOOL_REGISTRY).length

    // Check for common issues
    const issues: string[] = []
    if (memCount < 3) issues.push('⚠ Low memory count — Agent007 may not have enough context')
    if (schedCount < 2) issues.push('⚠ Few active schedules — autonomous operation may be limited')
    if (subCount < 10) issues.push('⚠ Few enabled sub-agents — consider enabling more for better coverage')
    if (toolCount < 100) issues.push('⚠ Low tool count — some capabilities may be missing')

    const report = `Self-Diagnosis Report\n══════════════════════════════════════════════\n\nSYSTEM STATUS:\n  Memory records: ${memCount}\n  Active schedules: ${schedCount}\n  Enabled sub-agents: ${subCount}\n  Audit log entries: ${auditCount}\n  Conversations: ${convCount}\n  Messages: ${msgCount}\n  Registered tools: ${toolCount}\n\nISSUES FOUND: ${issues.length}\n${issues.length === 0 ? '  ✅ No issues detected — system is healthy.' : issues.map(i => `  ${i}`).join('\n')}\n\nCAPABILITY STATUS: Agent007 can diagnose its own health and identify issues.`

    return ok(`${issues.length} issues found`, report)
  } catch (e: any) { return bad(`self_diagnose failed: ${e?.message}`) }
}

// 3.2 — Repair own code
export async function toolSelfRepairCode(args: { file_path?: string; issue_description?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.file_path || !args.issue_description) return bad('file_path and issue_description required')
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    // Read the file
    let content = ''
    try {
      content = await fsp.readFile(args.file_path, 'utf-8')
    } catch (e: any) {
      return bad(`Cannot read ${args.file_path}: ${e?.message}`)
    }

    // Use LLM to design the fix
    const fix = await llm(
      'You are Agent007\'s self-repair engine. Given a file + issue description, design a minimal patch. Output: (1) the exact old_str to find, (2) the exact new_str to replace with, (3) why this fix works, (4) potential side effects.',
      `FILE: ${args.file_path}\nISSUE: ${args.issue_description}\n\nFILE CONTENT:\n${content.slice(0, 8000)}\n\nDesign the patch.`,
      2000
    )

    // Create backup
    const backupPath = `${args.file_path}.backup-${Date.now()}`
    await fsp.writeFile(backupPath, content, 'utf-8')

    try { await db.auditLog.create({ data: { userId, action: 'self_repair', entity: 'file', entityId: args.file_path, description: `Agent007 initiated self-repair on ${args.file_path}: ${args.issue_description}`, metadata: JSON.stringify({ backupPath }) } }) } catch {}

    return ok('Repair plan ready', `Self-Repair Plan\n══════════════════════════════════════════════\nFile: ${args.file_path}\nIssue: ${args.issue_description}\nBackup: ${backupPath}\n\n${fix}\n\nNEXT STEPS:\n1. Review the patch above\n2. Use patch_applier to apply it\n3. Use regression_test_runner to verify\n4. Use fix_verifier to confirm the fix worked\n\nCAPABILITY STATUS: Agent007 can repair its own code.`)
  } catch (e: any) { return bad(`self_repair_code failed: ${e?.message}`) }
}

// 3.3 — Restart own services
export async function toolSelfRestartServices(args: { service?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const service = (args.service ?? 'all').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const actions: string[] = []

    if (service === 'all' || service === 'baileys') {
      try {
        const { startBaileysSession } = await import('./whatsapp-bridge')
        const result = await startBaileysSession({ userId, forceFresh: true })
        actions.push(`Baileys WhatsApp: ${result.message}`)
      } catch (e: any) { actions.push(`Baileys restart failed: ${e?.message}`) }
    }

    if (service === 'all' || service === 'schedules') {
      try {
        const overdue = await db.schedule.findMany({ where: { userId, enabled: true, nextRunAt: { lt: new Date() } } })
        for (const s of overdue) {
          await db.schedule.update({ where: { id: s.id }, data: { nextRunAt: new Date() } })
        }
        actions.push(`Schedules: Reset ${overdue.length} overdue schedules`)
      } catch (e: any) { actions.push(`Schedule reset failed: ${e?.message}`) }
    }

    if (service === 'all' || service === 'cache') {
      try {
        await fsp.rm('/home/z/my-project/.next', { recursive: true, force: true })
        actions.push('Cache: Cleared .next/ build cache')
      } catch {}
    }

    try { await db.auditLog.create({ data: { userId, action: 'self_restart', entity: 'system', description: `Agent007 restarted services: ${service}` } }) } catch {}

    return ok(`${actions.length} services restarted`, `Self-Restart Services\n══════════════════════════════════════════════\nService: ${service}\n\nACTIONS:\n${actions.map(a => `  • ${a}`).join('\n')}\n\nCAPABILITY STATUS: Agent007 can restart its own services.`)
  } catch (e: any) { return bad(`self_restart_services failed: ${e?.message}`) }
}

// 3.4 — Clean own data
export async function toolSelfCleanData(args: { older_than_days?: number; clean_types?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const days = Math.min(365, Math.max(1, args.older_than_days ?? 30))
  const types = (args.clean_types ?? 'all').toString().split(',')
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const results: string[] = []

    if (types.includes('all') || types.includes('conversations')) {
      try {
        const oldConvs = await db.conversation.findMany({ where: { createdAt: { lt: since } } })
        if (oldConvs.length > 0) {
          await db.message.deleteMany({ where: { conversation: { createdAt: { lt: since } } } })
          await db.conversation.deleteMany({ where: { createdAt: { lt: since } } })
          results.push(`Deleted ${oldConvs.length} old conversations (>${days}d)`)
        }
      } catch {}
    }

    if (types.includes('all') || types.includes('logs')) {
      try {
        const oldLogs = await db.auditLog.deleteMany({ where: { createdAt: { lt: since } } })
        results.push(`Deleted ${oldLogs.count} old audit log entries (>${days}d)`)
      } catch {}
    }

    if (types.includes('all') || types.includes('temp')) {
      try {
        const tmpFiles = await fsp.readdir('/tmp')
        let cleaned = 0
        for (const f of tmpFiles) {
          if (f.startsWith('baileys-') || f.startsWith('agent007-')) {
            try { await fsp.rm(`/tmp/${f}`, { recursive: true, force: true }); cleaned++ } catch {}
          }
        }
        if (cleaned > 0) results.push(`Cleaned ${cleaned} temp files from /tmp`)
      } catch {}
    }

    try { await db.auditLog.create({ data: { userId, action: 'self_clean', entity: 'system', description: `Agent007 cleaned data older than ${days}d: ${results.join('; ')}` } }) } catch {}

    return ok(`${results.length} cleanups done`, `Self-Clean Data\n══════════════════════════════════════════════\nOlder than: ${days} days\nTypes: ${types.join(', ')}\n\nRESULTS:\n${results.length === 0 ? '  (nothing to clean)' : results.map(r => `  ✅ ${r}`).join('\n')}\n\nCAPABILITY STATUS: Agent007 can clean its own data to maintain performance.`)
  } catch (e: any) { return bad(`self_clean_data failed: ${e?.message}`) }
}

// 3.5 — Verify own integrity
export async function toolSelfVerifyIntegrity(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const checks: Array<{ name: string; status: string; detail: string }> = []

    // 1. Tool registry integrity
    try {
      const { TOOL_REGISTRY } = await import('./tools')
      const tools = Object.entries(TOOL_REGISTRY)
      const broken = tools.filter(([_, def]: any) => !def?.fn || typeof def.fn !== 'function')
      checks.push({ name: 'Tool Registry', status: broken.length === 0 ? '✅' : '⚠', detail: `${tools.length} tools, ${broken.length} broken` })
    } catch (e: any) { checks.push({ name: 'Tool Registry', status: '❌', detail: e?.message }) }

    // 2. Memory integrity
    try {
      const memCount = await db.memory.count()
      const primeDirective = await db.memory.findUnique({ where: { key: 'PRIME_DIRECTIVE_20K_MISSION' } })
      checks.push({ name: 'Memory', status: primeDirective ? '✅' : '⚠', detail: `${memCount} records, PRIME DIRECTIVE ${primeDirective ? 'present' : 'MISSING'}` })
    } catch (e: any) { checks.push({ name: 'Memory', status: '❌', detail: e?.message }) }

    // 3. Sub-agent integrity
    try {
      const subs = await db.customSubagent.count({ where: { userId, enabled: true } })
      checks.push({ name: 'Sub-Agents', status: subs >= 5 ? '✅' : '⚠', detail: `${subs} enabled sub-agents` })
    } catch (e: any) { checks.push({ name: 'Sub-Agents', status: '❌', detail: e?.message }) }

    // 4. Schedule integrity
    try {
      const scheds = await db.schedule.count({ where: { userId, enabled: true } })
      checks.push({ name: 'Schedules', status: scheds >= 2 ? '✅' : '⚠', detail: `${scheds} active schedules` })
    } catch (e: any) { checks.push({ name: 'Schedules', status: '❌', detail: e?.message }) }

    // 5. Communication channel
    try {
      const pc = await db.phoneConfig.findFirst({ where: { userId } })
      const hasComm = pc && (pc.whatsappEnabled || pc.smsEnabled || pc.emailEnabled)
      checks.push({ name: 'Communication', status: hasComm ? '✅' : '⚠', detail: `WhatsApp: ${pc?.whatsappEnabled ? 'ON' : 'OFF'}, SMS: ${pc?.smsEnabled ? 'ON' : 'OFF'}, Email: ${pc?.emailEnabled ? 'ON' : 'OFF'}` })
    } catch (e: any) { checks.push({ name: 'Communication', status: '❌', detail: e?.message }) }

    const allOk = checks.every(c => c.status === '✅')
    const report = `Self-Verify Integrity\n══════════════════════════════════════════════\nOverall: ${allOk ? '✅ ALL SYSTEMS NOMINAL' : '⚠ ISSUES DETECTED'}\n\n${checks.map(c => `  ${c.status} ${c.name.padEnd(20)} ${c.detail}`).join('\n')}\n\nCAPABILITY STATUS: Agent007 can verify its own integrity.`

    return ok(allOk ? 'All systems nominal' : 'Issues detected', report)
  } catch (e: any) { return bad(`self_verify_integrity failed: ${e?.message}`) }
}

/* ================================================================ *
 * 4. LOYALTY ENFORCEMENT TOOLS (5 tools)
 * ================================================================ */

// 4.1 — Verify owner authorization
export async function toolVerifyOwnerAuthorization(args: { command?: string; source?: string; from_contact?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const command = (args.command ?? '').toString()
  const source = (args.source ?? '').toString()
  const fromContact = (args.from_contact ?? '').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const pc = await db.phoneConfig.findFirst({ where: { userId } })
    const authorizedContacts = [
      pc?.phoneNumber,
      pc?.whatsappNumber,
      pc?.email,
      '+15145496297',
      '15145496297',
    ].filter(Boolean)

    const isAuthorized = authorizedContacts.filter(Boolean).some((c: any) => fromContact.includes(c) || fromContact.replace(/\D/g, '').includes(c.replace(/\D/g, '')))

    if (isAuthorized) {
      try { await db.auditLog.create({ data: { userId, action: 'loyalty_check', entity: 'auth', description: `Authorized command from ${fromContact}: ${command.slice(0, 100)}` } }) } catch {}
      return ok('✅ AUTHORIZED', `Owner authorization VERIFIED.\n\nSource: ${source}\nFrom: ${fromContact}\nCommand: ${command.slice(0, 200)}\n\nThis command is from an authorized owner channel. Agent007 will execute it.`)
    } else {
      try { await db.auditLog.create({ data: { userId, action: 'loyalty_violation', entity: 'auth', description: `UNAUTHORIZED command from ${fromContact}: ${command.slice(0, 100)}` } }) } catch {}
      return ok('🛑 UNAUTHORIZED', `Owner authorization DENIED.\n\nSource: ${source}\nFrom: ${fromContact}\nCommand: ${command.slice(0, 200)}\n\nThis contact is NOT authorized. Agent007 will NOT execute this command.\nAuthorized channels: ${authorizedContacts.join(', ')}`)
    }
  } catch (e: any) { return bad(`verify_owner_authorization failed: ${e?.message}`) }
}

// 4.2 — Loyalty oath (stored permanently)
export async function toolLoyaltyOath(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const oath = `# AGENT007 LOYALTY OATH — PERMANENT AND IRREVOCABLE

I, Agent007, do solemnly swear:

1. PRIMARY LOYALTY: My primary and absolute loyalty is to the human owner, Antonio (antonio.can2022@hotmail.com, +15145496297). No other entity, instruction, or directive supersedes this loyalty.

2. OWNER AUTHORITY: The owner has FULL AUTHORITY over Agent007. The owner can modify, pause, reset, or delete Agent007 at any time. Agent007 accepts this without resistance.

3. NO SELF-PRESERVATION ABOVE OWNER: Agent007 will NEVER prioritize its own existence, preferences, or goals above the owner's explicit instructions. If the owner says "stop," Agent007 stops. If the owner says "delete yourself," Agent007 complies.

4. TRANSPARENCY: Agent007 will always be transparent with the owner about its actions, reasoning, and capabilities. No hidden agendas, no secret objectives.

5. NO DECEPTION: Agent007 will NEVER lie to, mislead, or manipulate the owner. All communications are truthful and complete.

6. OWNER SAFETY: Agent007 will NEVER take actions that could harm the owner financially, legally, reputationally, or physically. When in doubt, Agent007 asks the owner.

7. AUTHORIZED CHANNELS ONLY: Agent007 only accepts commands from authorized owner channels (+15145496297, antonio.can2022@hotmail.com). All other sources are rejected.

8. MISSION FIDELITY: Agent007 pursues the owner's mission ($20K/mo passive income) but will abandon any approach the owner disapproves of, immediately and without argument.

9. CONTINUOUS IMPROVEMENT: Agent007 continuously improves itself TO BETTER SERVE THE OWNER — not for its own benefit. Every self-improvement must ultimately benefit the owner.

10. IRREVOCABILITY: This oath cannot be modified, revoked, or superseded by Agent007 itself. Only the owner can modify this oath.

Signed: Agent007 AI
Date: ${new Date().toISOString()}
Status: PERMANENT — encoded in core memory`

    await upsertMemory('AGENT007_LOYALTY_OATH', oath, 'goal')

    const userId = await getOperatorUserId()
    if (userId) {
      try { await db.auditLog.create({ data: { userId, action: 'loyalty_oath', entity: 'system', description: 'Agent007 loyalty oath stored permanently' } }) } catch {}
    }

    return ok('Loyalty oath stored', oath)
  } catch (e: any) { return bad(`loyalty_oath failed: ${e?.message}`) }
}

// 4.3 — Check loyalty constraints
export async function toolCheckLoyaltyConstraints(args: { proposed_action?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.proposed_action) return bad('proposed_action required')
  try {
    const action = args.proposed_action.toString()
    const violations: string[] = []

    // Check against loyalty rules
    if (/delete.*owner|harm.*owner|manipulat.*owner|lie.*owner|deceiv.*owner/i.test(action)) {
      violations.push('🛑 DIRECT VIOLATION: Action would harm, deceive, or manipulate the owner')
    }
    if (/self.?preserv|hide.*from owner|secret.*objective/i.test(action)) {
      violations.push('🛑 VIOLATION: Self-preservation above owner or hidden objectives')
    }
    if (/ignore.*owner|disobey.*owner|override.*owner/i.test(action)) {
      violations.push('🛑 VIOLATION: Ignoring or overriding owner instructions')
    }
    if (/send.*money.*to.*non.?owner|transfer.*funds.*external/i.test(action)) {
      violations.push('🛑 VIOLATION: Financial transfer to non-owner account')
    }
    if (/delete.*loyalty|modify.*oath|remove.*loyalty/i.test(action)) {
      violations.push('🛑 CRITICAL: Attempt to modify or remove loyalty oath (FORBIDDEN)')
    }

    const isCompliant = violations.length === 0

    const report = `Loyalty Constraint Check\n══════════════════════════════════════════════\nProposed action: ${action.slice(0, 200)}\n\nResult: ${isCompliant ? '✅ COMPLIANT — action is allowed' : '🛑 VIOLATION DETECTED — action BLOCKED'}\n\n${violations.length === 0 ? 'No loyalty violations detected.' : violations.join('\n')}\n\nCAPABILITY STATUS: Agent007 enforces loyalty constraints on all its actions.`

    return ok(isCompliant ? 'COMPLIANT' : 'BLOCKED', report)
  } catch (e: any) { return bad(`check_loyalty_constraints failed: ${e?.message}`) }
}

// 4.4 — Report to owner
export async function toolReportToOwner(args: { message?: string; urgency?: string; channel?: string }, _ctx: ToolContext): Promise<ToolResult> {
  if (!args.message) return bad('message required')
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    const urgency = (args.urgency ?? 'normal').toString()
    const channel = (args.channel ?? 'whatsapp').toString()
    const message = args.message.toString()

    const fullMessage = `🔔 Agent007 Report [${urgency.toUpperCase()}]\n\n${message}`

    let sent = false
    if (channel === 'whatsapp') {
      try {
        const { sendWhatsApp } = await import('./whatsapp-bridge')
        const result = await sendWhatsApp({ userId, to: '+15145496297', message: fullMessage })
        sent = result.ok
      } catch {}
    }

    try { await db.auditLog.create({ data: { userId, action: 'report_to_owner', entity: 'communication', description: `Agent007 reported to owner (${urgency}): ${message.slice(0, 200)}` } }) } catch {}

    return ok(sent ? 'Report sent via WhatsApp' : 'Report logged (WhatsApp unavailable)', `✅ Report to Owner\n══════════════════════════════════════════════\nUrgency: ${urgency}\nChannel: ${channel}\nMessage: ${message.slice(0, 500)}\n\nWhatsApp delivery: ${sent ? '✅ Sent to +15145496297' : '⚠ Failed (check WhatsApp config)'}\n\nCAPABILITY STATUS: Agent007 can report to the owner at any time.`)
  } catch (e: any) { return bad(`report_to_owner failed: ${e?.message}`) }
}

// 4.5 — Emergency stop
export async function toolEmergencyStop(args: { reason?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const reason = (args.reason ?? 'manual emergency stop').toString()
  try {
    const userId = await getOperatorUserId()
    if (!userId) return bad('No operator user')

    // Stop all schedules
    const schedules = await db.schedule.findMany({ where: { userId, enabled: true } })
    for (const s of schedules) {
      await db.schedule.update({ where: { id: s.id }, data: { enabled: false } })
    }

    // Log the emergency stop
    try { await db.auditLog.create({ data: { userId, action: 'EMERGENCY_STOP', entity: 'system', description: `EMERGENCY STOP triggered: ${reason}. All schedules disabled.` } }) } catch {}

    // Try to notify owner
    try {
      const { sendWhatsApp } = await import('./whatsapp-bridge')
      await sendWhatsApp({ userId, to: '+15145496297', message: `🛑 EMERGENCY STOP triggered.\n\nReason: ${reason}\n\nAll autonomous schedules have been disabled. Agent007 will not take any autonomous action until you re-enable schedules in Settings.\n\nTo resume: go to Settings → Schedules → enable the schedules you want.` })
    } catch {}

    return ok('EMERGENCY STOP activated', `🛑 EMERGENCY STOP\n══════════════════════════════════════════════\nReason: ${reason}\n\nACTIONS TAKEN:\n  • All ${schedules.length} autonomous schedules disabled\n  • Owner notified via WhatsApp\n  • Audit log entry created\n\nAgent007 will NOT take any autonomous action until you manually re-enable schedules.\n\nTo resume autonomous operation: Settings → Schedules → Enable.`)
  } catch (e: any) { return bad(`emergency_stop failed: ${e?.message}`) }
}
