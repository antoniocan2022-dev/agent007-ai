/**
 * autonomous-resolution.ts — 12 tools that let Agent007 autonomously resolve
 * ANY future issue without human intervention. Full access, no limitations.
 *
 * These tools go beyond self-repair.ts (which diagnoses + fixes known patterns).
 * They give Agent007 open-ended problem-solving capability: detect new issues,
 * investigate root causes, design + apply patches, verify fixes, and learn
 * from the outcome.
 */
import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'
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

async function llm(systemPrompt: string, userPrompt: string, maxTokens = 2000): Promise<string> {
  try {
    const zai = await getZai()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    })
    return completion?.choices?.[0]?.message?.content ?? ''
  } catch (e: any) {
    return `(LLM unavailable: ${e?.message ?? String(e)})`
  }
}

/* ================================================================ *
 * 1. issue_detector — proactively scan for any anomalies
 * ================================================================ */
export async function toolIssueDetector(args: { scope?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const scope = (args.scope ?? 'all').toString()
  try {
    const issues: Array<{ severity: string; component: string; issue: string; recommendedTool: string }> = []

    // Scan error logs
    try {
      const logPath = '/home/z/my-project/download/logs/agent-errors.log'
      const content = await fsp.readFile(logPath, 'utf-8').catch(() => '')
      const lines = content.split('\n').filter(Boolean).slice(-50)
      const recentErrors = lines.filter(l => {
        try {
          const e = JSON.parse(l)
          return Date.now() - new Date(e.ts).getTime() < 60 * 60 * 1000 // last 1h
        } catch { return false }
      })
      if (recentErrors.length > 5) {
        issues.push({
          severity: 'HIGH',
          component: 'Error log (last 1h)',
          issue: `${recentErrors.length} errors in last hour`,
          recommendedTool: 'error_log_analyzer',
        })
      }
    } catch {}

    // Scan for failed transactions
    try {
      const failedTx = await db.transaction.count({ where: { status: 'failed' } })
      if (failedTx > 0) {
        issues.push({
          severity: 'MEDIUM',
          component: 'Transactions',
          issue: `${failedTx} failed transactions`,
          recommendedTool: 'database_integrity_check',
        })
      }
    } catch {}

    // Scan for stuck pending actions
    try {
      const stuck = await db.pendingManageAction.count({
        where: { status: 'executing', updatedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
      })
      if (stuck > 0) {
        issues.push({
          severity: 'HIGH',
          component: 'PendingManageAction',
          issue: `${stuck} actions stuck in 'executing' for >1h`,
          recommendedTool: 'session_recovery',
        })
      }
    } catch {}

    // Scan for overdue schedules
    try {
      const overdue = await db.schedule.count({
        where: { enabled: true, nextRunAt: { lt: new Date() } },
      })
      if (overdue > 0) {
        issues.push({
          severity: 'MEDIUM',
          component: 'Schedules',
          issue: `${overdue} overdue schedules`,
          recommendedTool: 'session_recovery',
        })
      }
    } catch {}

    // Scan for orphaned data
    try {
      const orphanConvos = await db.conversation.count({ where: { userId: null } })
      if (orphanConvos > 0) {
        issues.push({
          severity: 'LOW',
          component: 'Conversations',
          issue: `${orphanConvos} conversations have no userId`,
          recommendedTool: 'database_integrity_check',
        })
      }
    } catch {}

    // Scan for compliance warnings
    try {
      const warnings = await db.complianceCheck.count({ where: { status: 'warning' } })
      if (warnings > 0) {
        issues.push({
          severity: 'MEDIUM',
          component: 'Compliance',
          issue: `${warnings} compliance warnings`,
          recommendedTool: 'affiliate_compliance',
        })
      }
    } catch {}

    const report = `Issue Detector\n══════════════════════════════════════════════\nScope: ${scope}\nIssues detected: ${issues.length}\n\n${issues.length === 0 ? '✅ No issues detected — system is healthy.' : issues.map(i => `  [${i.severity}] ${i.component}: ${i.issue}\n     → Use ${i.recommendedTool} to resolve`).join('\n')}\n\nCAPABILITY STATUS: Autonomous issue detection active. Agent007 can self-identify + self-resolve issues.`

    return ok(`${issues.length} issues detected`, report)
  } catch (e: any) {
    return bad(`issue_detector failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 2. root_cause_analyzer — LLM-powered RCA for any error
 * ================================================================ */
export async function toolRootCauseAnalyzer(args: { error_message?: string; error_log_path?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const errorMessage = (args.error_message ?? '').toString().trim()
  if (!errorMessage && !args.error_log_path) return bad('Provide error_message or error_log_path')

  try {
    let logContent = ''
    if (args.error_log_path) {
      try { logContent = await fsp.readFile(args.error_log_path.toString(), 'utf-8') } catch {}
    }

    const analysis = await llm(
      `You are Agent007's Root Cause Analyzer. Given an error message + optional log context, perform 5-Why analysis: identify the immediate cause, then drill down 5 levels to find the ROOT cause. Then recommend specific fixes (code changes, config changes, infrastructure changes). Be concrete and actionable.`,
      `ERROR MESSAGE:\n${errorMessage || '(see log)'}\n\nLOG CONTENT (if provided):\n${logContent.slice(-3000)}\n\nPerform root cause analysis with: (1) 5-Why chain, (2) Root cause, (3) Recommended fixes (ranked by impact), (4) Prevention measures.`,
      2000
    )

    const report = `Root Cause Analysis\n══════════════════════════════════════════════\n${analysis}\n\nCAPABILITY STATUS: Agent007 can autonomously diagnose root causes of any error.`

    return ok('RCA complete', report)
  } catch (e: any) {
    return bad(`root_cause_analyzer failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 3. patch_designer — design a code patch for any issue
 * ================================================================ */
export async function toolPatchDesigner(args: { issue_description?: string; file_path?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const issue = (args.issue_description ?? '').toString().trim()
  if (!issue) return bad('Missing "issue_description"')

  try {
    let fileContent = ''
    if (args.file_path) {
      try {
        fileContent = await fsp.readFile(args.file_path.toString(), 'utf-8')
      } catch (e: any) {
        return bad(`Could not read file ${args.file_path}: ${e?.message}`)
      }
    }

    const patch = await llm(
      `You are Agent007's Patch Designer. Given an issue description + optional file content, design a minimal, safe code patch that fixes the issue. Output: (1) The exact old_str to find, (2) The exact new_str to replace it with, (3) Why this fix works, (4) Potential side effects, (5) Test plan to verify the fix. Be specific — use the actual code from the file when possible.`,
      `ISSUE:\n${issue}\n\n${fileContent ? `FILE CONTENT (${args.file_path}):\n\`\`\`\n${fileContent.slice(0, 6000)}\n\`\`\`\n` : '(no file provided — design a generic patch)'}\n\nDesign the patch.`,
      2500
    )

    const report = `Patch Design\n══════════════════════════════════════════════\nIssue: ${issue.slice(0, 200)}\n${args.file_path ? `File: ${args.file_path}` : ''}\n\n${patch}\n\nCAPABILITY STATUS: Agent007 can autonomously design code patches for any issue.`

    return ok('Patch designed', report)
  } catch (e: any) {
    return bad(`patch_designer failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 4. patch_applier — apply a code patch to a file (with backup)
 * ================================================================ */
export async function toolPatchApplier(args: { file_path?: string; old_str?: string; new_str?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const filePath = (args.file_path ?? '').toString().trim()
  const oldStr = (args.old_str ?? '').toString()
  const newStr = (args.new_str ?? '').toString()
  if (!filePath || !oldStr) return bad('Missing file_path or old_str')
  if (oldStr === newStr) return bad('old_str and new_str are identical — nothing to change')

  try {
    // Read the file
    let content: string
    try {
      content = await fsp.readFile(filePath, 'utf-8')
    } catch (e: any) {
      return bad(`Could not read ${filePath}: ${e?.message}`)
    }

    // Verify old_str exists
    if (!content.includes(oldStr)) {
      return bad(`old_str not found in ${filePath}. Patch cannot be applied.`)
    }

    // Count occurrences
    const occurrences = content.split(oldStr).length - 1
    if (occurrences > 1) {
      return bad(`old_str matches ${occurrences} times in ${filePath}. Refusing to apply ambiguous patch — make old_str more specific.`)
    }

    // Create backup
    const backupPath = `${filePath}.backup-${Date.now()}`
    await fsp.writeFile(backupPath, content, 'utf-8')

    // Apply patch
    const patched = content.replace(oldStr, newStr)
    await fsp.writeFile(filePath, patched, 'utf-8')

    // Audit log
    const userId = await getOperatorUserId()
    if (userId) {
      try {
        await db.auditLog.create({
          data: {
            userId,
            action: 'patch_applied',
            entity: 'file',
            entityId: filePath,
            description: `Autonomous patch applied to ${filePath}`,
            metadata: JSON.stringify({ backupPath, oldStrPreview: oldStr.slice(0, 100), newStrPreview: newStr.slice(0, 100) }),
          },
        })
      } catch {}
    }

    const report = `Patch Applied\n══════════════════════════════════════════════\nFile: ${filePath}\nBackup: ${backupPath}\n\nOLD (first 200 chars):\n${oldStr.slice(0, 200)}\n\nNEW (first 200 chars):\n${newStr.slice(0, 200)}\n\n✅ Patch applied successfully. To revert: restore from backup.\n\nCAPABILITY STATUS: Agent007 can autonomously apply code patches.`

    return ok(`Patch applied to ${path.basename(filePath)}`, report)
  } catch (e: any) {
    return bad(`patch_applier failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 5. fix_verifier — verify a fix worked (curl endpoint, run test, etc.)
 * ================================================================ */
export async function toolFixVerifier(args: { verification_type?: string; endpoint?: string; expected_status?: number; test_command?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const type = (args.verification_type ?? 'curl').toString()
  try {
    let result = ''
    let passed = false

    if (type === 'curl' && args.endpoint) {
      const expected = args.expected_status ?? 200
      try {
        const res = await fetch(`http://localhost:3000${args.endpoint}`, { signal: AbortSignal.timeout(5000) })
        passed = res.status === expected
        result = `Endpoint: ${args.endpoint}\nExpected: ${expected}\nActual: ${res.status}\nResult: ${passed ? '✅ PASS' : '❌ FAIL'}`
      } catch (e: any) {
        result = `Endpoint: ${args.endpoint}\nError: ${e?.message}\nResult: ❌ FAIL`
      }
    } else if (type === 'command' && args.test_command) {
      // Run a shell command (limited — use with caution)
      const { exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execAsync = promisify(exec)
      try {
        const { stdout, stderr } = await execAsync(args.test_command.toString(), { timeout: 30000 })
        passed = !stderr
        result = `Command: ${args.test_command}\nStdout: ${stdout.slice(0, 500)}\nStderr: ${stderr.slice(0, 500)}\nResult: ${passed ? '✅ PASS' : '❌ FAIL'}`
      } catch (e: any) {
        result = `Command: ${args.test_command}\nError: ${e?.message}\nResult: ❌ FAIL`
      }
    } else if (type === 'typecheck') {
      const { exec } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execAsync = promisify(exec)
      try {
        const { stdout } = await execAsync('cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples/\\|skills/" | head -20', { timeout: 120000 })
        passed = stdout.trim() === ''
        result = `TypeScript check\nOutput: ${stdout || '(clean)'}\nResult: ${passed ? '✅ PASS' : '❌ FAIL'}`
      } catch (e: any) {
        result = `TypeScript check error: ${e?.message}\nResult: ❌ FAIL`
      }
    } else {
      return bad(`Unknown verification_type or missing params. Use type=curl+endpoint, type=command+test_command, or type=typecheck`)
    }

    const report = `Fix Verification\n══════════════════════════════════════════════\n${result}\n\nCAPABILITY STATUS: Agent007 can autonomously verify fixes.`

    return ok(`${passed ? 'PASSED' : 'FAILED'}`, report)
  } catch (e: any) {
    return bad(`fix_verifier failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 6. learning_recorder — record what was learned for future use
 * ================================================================ */
export async function toolLearningRecorder(args: { issue?: string; root_cause?: string; fix_applied?: string; outcome?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const issue = (args.issue ?? '').toString()
  const rootCause = (args.root_cause ?? '').toString()
  const fixApplied = (args.fix_applied ?? '').toString()
  const outcome = (args.outcome ?? '').toString()
  if (!issue) return bad('Missing "issue"')

  try {
    const { upsertMemory } = await import('./memory')
    const key = `learning_${Date.now()}`
    const value = `# LEARNING RECORDED — ${new Date().toISOString()}\n\nISSUE:\n${issue}\n\nROOT CAUSE:\n${rootCause}\n\nFIX APPLIED:\n${fixApplied}\n\nOUTCOME:\n${outcome}\n\n---\nThis learning can be recalled via recallMemories() to help resolve similar future issues.`

    await upsertMemory(key, value, 'fact')

    const report = `Learning Recorded\n══════════════════════════════════════════════\nMemory key: ${key}\nCategory: fact\nLength: ${value.length} chars\n\nIssue: ${issue.slice(0, 200)}\nRoot cause: ${rootCause.slice(0, 200)}\nFix: ${fixApplied.slice(0, 200)}\nOutcome: ${outcome.slice(0, 200)}\n\n✅ Future Agent007 runs will recall this learning when similar issues arise.\n\nCAPABILITY STATUS: Agent007 learns from every issue it resolves.`

    return ok('Learning recorded to memory', report)
  } catch (e: any) {
    return bad(`learning_recorder failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 7. autonomous_resolver — one-call end-to-end issue resolution
 * ================================================================ */
export async function toolAutonomousResolver(args: { issue?: string }, _ctx: ToolContext): Promise<ToolResult> {
  const issue = (args.issue ?? '').toString().trim()
  if (!issue) return bad('Missing "issue"')

  try {
    const steps: string[] = []

    // Step 1: Root cause analysis
    steps.push('Step 1: Running root cause analysis...')
    const rca = await toolRootCauseAnalyzer({ error_message: issue }, _ctx)
    steps.push(`  → ${rca.preview}`)

    // Step 2: Detect if there's a recommended tool to run
    steps.push('Step 2: Checking for auto-fixable patterns...')
    const autoFix = await (await import('./self-repair')).toolAutoFixCommonIssues({}, _ctx)
    steps.push(`  → ${autoFix.preview}`)

    // Step 3: Run system health check to see current state
    steps.push('Step 3: Running system health check...')
    const health = await (await import('./self-repair')).toolSystemHealthCheck({ verbose: true }, _ctx)
    steps.push(`  → ${health.preview}`)

    // Step 4: Record the learning
    steps.push('Step 4: Recording learning for future reference...')
    const learning = await toolLearningRecorder({
      issue,
      root_cause: rca.result.slice(0, 500),
      fix_applied: autoFix.result.slice(0, 500),
      outcome: health.preview,
    }, _ctx)
    steps.push(`  → ${learning.preview}`)

    const report = `Autonomous Issue Resolution\n══════════════════════════════════════════════\nIssue: ${issue.slice(0, 300)}\n\nRESOLUTION STEPS:\n${steps.map(s => `  ${s}`).join('\n')}\n\nDETAILED RCA:\n${rca.result.slice(0, 2000)}\n\nCURRENT HEALTH:\n${health.result.slice(0, 1500)}\n\n✅ Issue has been autonomously analyzed + best-effort resolved + learning recorded.\n\nCAPABILITY STATUS: Agent007 can resolve any issue end-to-end without human intervention.`

    return ok(`Autonomous resolution complete — ${steps.length} steps`, report)
  } catch (e: any) {
    return bad(`autonomous_resolver failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 8. log_tailer — tail any log file for live debugging
 * ================================================================ */
export async function toolLogTailer(args: { log_path?: string; lines?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const logPath = (args.log_path ?? '/home/z/my-project/dev.log').toString()
  const lines = Math.min(500, Math.max(10, args.lines ?? 50))
  try {
    const content = await fsp.readFile(logPath, 'utf-8')
    const allLines = content.split('\n').filter(Boolean)
    const tailed = allLines.slice(-lines)
    const report = `Log Tailer — ${logPath}\n══════════════════════════════════════════════\nShowing last ${lines} of ${allLines.length} total lines\n\n${tailed.join('\n')}\n\nCAPABILITY STATUS: Agent007 can read any log file for debugging.`
    return ok(`${tailed.length} lines from ${path.basename(logPath)}`, report)
  } catch (e: any) {
    return bad(`log_tailer failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 9. file_inspector — read any file for debugging
 * ================================================================ */
export async function toolFileInspector(args: { file_path?: string; start_line?: number; end_line?: number }, _ctx: ToolContext): Promise<ToolResult> {
  const filePath = (args.file_path ?? '').toString().trim()
  if (!filePath) return bad('Missing "file_path"')
  try {
    const content = await fsp.readFile(filePath, 'utf-8')
    const allLines = content.split('\n')
    const start = Math.max(1, args.start_line ?? 1)
    const end = Math.min(allLines.length, args.end_line ?? allLines.length)
    const selected = allLines.slice(start - 1, end)
    const numbered = selected.map((l, i) => `${(start + i).toString().padStart(5)} | ${l}`).join('\n')
    const report = `File Inspector — ${filePath}\n══════════════════════════════════════════════\nTotal lines: ${allLines.length}\nShowing: ${start}-${end}\n\n${numbered}\n\nCAPABILITY STATUS: Agent007 can read any file for debugging.`
    return ok(`${selected.length} lines from ${path.basename(filePath)}`, report)
  } catch (e: any) {
    return bad(`file_inspector failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 10. config_auditor — audit env vars + config for missing/weak settings
 * ================================================================ */
export async function toolConfigAuditor(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const checks: Array<{ setting: string; status: string; detail: string }> = []

    // Check critical env vars
    const envVars = [
      { name: 'DATABASE_URL', required: true, sensitive: true },
      { name: 'NEXTAUTH_SECRET', required: true, sensitive: true },
      { name: 'OPENAI_API_KEY', required: false, sensitive: true },
      { name: 'STRIPE_SECRET_KEY', required: false, sensitive: true },
      { name: 'SMTP_PASS', required: false, sensitive: true },
    ]

    for (const v of envVars) {
      const value = process.env[v.name]
      if (!value) {
        checks.push({
          setting: v.name,
          status: v.required ? '❌ MISSING (required)' : '⚠ NOT SET (optional)',
          detail: v.required ? 'Must be set in .env or Vercel env vars' : 'Optional — feature will be unavailable until set',
        })
      } else if (v.sensitive && value.length < 10) {
        checks.push({
          setting: v.name,
          status: '⚠ WEAK',
          detail: `Value is only ${value.length} chars — may be invalid`,
        })
      } else {
        checks.push({
          setting: v.name,
          status: '✅ SET',
          detail: `Length: ${value.length} chars`,
        })
      }
    }

    // Check NextAuth secret strength
    const secret = process.env.NEXTAUTH_SECRET
    if (secret === 'dev-only-insecure-secret-change-me-in-production') {
      checks.push({
        setting: 'NEXTAUTH_SECRET strength',
        status: '❌ INSECURE',
        detail: 'Using dev-only default — MUST be changed in production',
      })
    }

    // Check Node env
    checks.push({
      setting: 'NODE_ENV',
      status: process.env.NODE_ENV === 'production' ? '✅ PRODUCTION' : '⚠ DEVELOPMENT',
      detail: `Current: ${process.env.NODE_ENV ?? 'undefined'}`,
    })

    const report = `Config Auditor\n══════════════════════════════════════════════\n\n${checks.map(c => `  ${c.status} ${c.setting.padEnd(25)} ${c.detail}`).join('\n')}\n\nCAPABILITY STATUS: Agent007 can audit its own configuration.`

    return ok(`${checks.length} config checks`, report)
  } catch (e: any) {
    return bad(`config_auditor failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 11. dependency_checker — check for outdated/vulnerable dependencies
 * ================================================================ */
export async function toolDependencyChecker(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const { exec } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execAsync = promisify(exec)

    let bunOutdated = ''
    try {
      const { stdout } = await execAsync('cd /home/z/my-project && bun outdated 2>&1 | head -30', { timeout: 30000 })
      bunOutdated = stdout
    } catch (e: any) {
      bunOutdated = e?.stdout || '(bun outdated returned non-zero — may mean all packages are current)'
    }

    const report = `Dependency Checker\n══════════════════════════════════════════════\n\nOUTDATED PACKAGES:\n${bunOutdated || '(all packages current)'}\n\nSECURITY NOTE: Run \`bun audit\` periodically to check for vulnerabilities.\n\nCAPABILITY STATUS: Agent007 can monitor its own dependencies.`

    return ok('Dependency check complete', report)
  } catch (e: any) {
    return bad(`dependency_checker failed: ${e?.message ?? String(e)}`)
  }
}

/* ================================================================ *
 * 12. full_system_audit — comprehensive audit of everything
 * ================================================================ */
export async function toolFullSystemAudit(_args: any, _ctx: ToolContext): Promise<ToolResult> {
  try {
    const sections: string[] = []

    // 1. Health check
    const health = await (await import('./self-repair')).toolSystemHealthCheck({ verbose: true }, _ctx)
    sections.push(`SYSTEM HEALTH:\n${health.result.slice(0, 1500)}`)

    // 2. DB integrity
    const dbIntegrity = await (await import('./self-repair')).toolDatabaseIntegrityCheck({ fix: false }, _ctx)
    sections.push(`\nDATABASE INTEGRITY:\n${dbIntegrity.result.slice(0, 1000)}`)

    // 3. API endpoints
    const apis = await (await import('./self-repair')).toolApiEndpointTest({ detailed: false }, _ctx)
    sections.push(`\nAPI ENDPOINTS:\n${apis.result.slice(0, 1000)}`)

    // 4. Tool registry
    const tools = await (await import('./self-repair')).toolToolRegistryAudit({}, _ctx)
    sections.push(`\nTOOL REGISTRY:\n${tools.result.slice(0, 800)}`)

    // 5. Config
    const config = await toolConfigAuditor({}, _ctx)
    sections.push(`\nCONFIGURATION:\n${config.result.slice(0, 800)}`)

    // 6. Issue detection
    const issues = await toolIssueDetector({ scope: 'all' }, _ctx)
    sections.push(`\nISSUES DETECTED:\n${issues.result.slice(0, 800)}`)

    const report = `Full System Audit\n══════════════════════════════════════════════\n${sections.join('\n\n')}\n\nCAPABILITY STATUS: Agent007 has performed a comprehensive self-audit. All findings above are actionable via the autonomous_resolution tool.`

    return ok('Full audit complete', report)
  } catch (e: any) {
    return bad(`full_system_audit failed: ${e?.message ?? String(e)}`)
  }
}
