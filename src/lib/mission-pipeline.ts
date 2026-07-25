/**
 * mission-pipeline.ts — UPGRADE #139 (Sequential Team Pipeline — Rec 4)
 * ===================================================================
 * Defines ORDERED pipelines per mission type and runs them with:
 *   - Super Agent verification gate between every team (Rec 1)
 *   - Iterative correction loop on rejection (Rec 2)
 *   - CEO final presenter at the end (Rec 3)
 *   - Audit trail logging at every step (Rec 5)
 *   - Telegram milestones at every stage (Rec 6)
 *   - Optional owner approval gate for high-stakes missions (Rec 7)
 *
 * USAGE:
 *   import { runMissionPipeline } from './mission-pipeline'
 *   await runMissionPipeline({
 *     missionId: 'mission_xxx',
 *     pipelineType: 'product_launch',
 *     objective: 'Launch a $9/mo PDF annotator SaaS',
 *   })
 */

import { runSubagent } from './subagents'
import { superAgentVerify, buildRetryPrompt, formatVerificationResult, type VerificationResult } from './super-agent-verifier'
import { ceoPresentToOwner, type MissionStageSummary } from './ceo-presenter'
import { logApprovalEvent, type ApprovalEventInput } from './approval-audit-log'
import { notifyTelegram } from './mission-notifier'

// ──────────────────────────────────────────────────────────────────
// PIPELINE DEFINITIONS
// ──────────────────────────────────────────────────────────────────

export interface PipelineStage {
  stage: number
  team: string       // pod id (e.g. 'scout', 'aurora')
  leader: string     // subagent id (e.g. 'scout', 'aurora')
  name: string       // human-readable stage name
  artifactType: 'url' | 'transaction_id' | 'message_id' | 'file_path' | 'data' | 'none'
  requirements: string  // what this stage must produce
  promptTemplate: (objective: string) => string  // builds the task for the leader
}

export interface PipelineDef {
  type: string
  name: string
  description: string
  requiresOwnerApproval?: boolean  // Rec 7 — high-stakes missions pause for owner
  stages: PipelineStage[]
}

/**
 * UPGRADE #139 — Built-in pipeline templates.
 * Each mission type has its own ordered sequence of teams.
 * The CEO is ALWAYS the final stage (Rec 3).
 */
export const MISSION_PIPELINES: Record<string, PipelineDef> = {
  product_launch: {
    type: 'product_launch',
    name: 'Product Launch',
    description: 'Full SaaS / product launch: research → design → build → QA → deploy → market → CEO report',
    requiresOwnerApproval: true,  // involves money + public launch
    stages: [
      {
        stage: 1, team: 'scout', leader: 'scout', name: 'Market Research',
        artifactType: 'data',
        requirements: 'Market research report with: target audience, competitor analysis, pricing benchmarks, demand signals (search volume, forum activity). At least 3 concrete data points.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 1: Market Research.\nFind: (1) target audience pain points, (2) top 3 competitors with pricing, (3) demand signals (search volume, Reddit/forum mentions, GitHub stars if dev tool). Return a structured research report with at least 3 cited data points.`,
      },
      {
        stage: 2, team: 'aurora', leader: 'aurora', name: 'Monetization Strategy',
        artifactType: 'data',
        requirements: 'Pricing strategy document with: 3-tier pricing, revenue projection for months 1-3, customer acquisition plan, monetization model rationale.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 2: Monetization Strategy.\nBased on Scout's research, design: (1) 3-tier pricing (free / pro / business), (2) revenue projection table for months 1-3, (3) customer acquisition plan (channels + cost per acquisition), (4) rationale for the chosen monetization model. Be specific with numbers.`,
      },
      {
        stage: 3, team: 'vertex', leader: 'vertex', name: 'Product Blueprint',
        artifactType: 'data',
        requirements: 'Product blueprint: feature list (MVP + post-MVP), tech stack, data model, wireframe descriptions, deployment plan.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 3: Product Blueprint.\nDesign: (1) MVP feature list (max 5 features), (2) post-MVP features, (3) tech stack (framework, DB, hosting, payments), (4) data model (entities + relationships), (5) wireframe descriptions for each page, (6) deployment plan (Vercel + Stripe).`,
      },
      {
        stage: 4, team: 'forge', leader: 'forge', name: 'Build & Deploy',
        artifactType: 'url',
        requirements: 'Live, deployed URL of the product. Must be accessible via HTTP 200. Include GitHub repo URL if applicable.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: Build & Deploy.\nBuild the MVP according to Nova's blueprint. Deploy to Vercel. Return: (1) live URL, (2) GitHub repo URL, (3) list of features implemented, (4) any features deferred to post-MVP. The URL MUST return HTTP 200.`,
      },
      {
        stage: 5, team: 'echo', leader: 'echo', name: 'QA & Quality Audit',
        artifactType: 'data',
        requirements: 'QA report: test results (functional, security, performance), bug list (with severity), go/no-go recommendation.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 5: QA & Quality Audit.\nRun: (1) functional tests on every MVP feature, (2) security audit (XSS, CSRF, auth), (3) performance audit (Lighthouse score), (4) cross-browser check. Return a structured QA report with bug list (severity P0-P3) and a go/no-go recommendation.`,
      },
      {
        stage: 6, team: 'quantum', leader: 'quantum', name: 'Marketing Campaign',
        artifactType: 'data',
        requirements: 'Marketing plan: channel selection (Twitter, Reddit, HN, PH, etc.), launch sequence (day-by-day), content templates, KPI targets.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 6: Marketing Campaign.\nDesign: (1) channel selection with rationale (Twitter, Reddit, HN, Product Hunt, IndieHackers, etc.), (2) day-by-day launch sequence (7 days), (3) content templates for each channel, (4) KPI targets (signups, MRR, mentions). Be specific — owner will execute.`,
      },
      {
        stage: 7, team: 'ceo', leader: 'ceo', name: 'CEO Final Report',
        artifactType: 'none',
        requirements: 'CEO aggregates all stages into an executive report for the owner.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 7 (FINAL): CEO Executive Report.\nAs CEO, aggregate all previous stage outputs into a single executive summary for Antonio. Follow the CEO report format exactly.`,
      },
    ],
  },

  content_creation: {
    type: 'content_creation',
    name: 'Content Creation',
    description: 'Research → draft → publish → promote → CEO report',
    requiresOwnerApproval: false,  // content is low-risk
    stages: [
      {
        stage: 1, team: 'scout', leader: 'scout', name: 'Topic Research',
        artifactType: 'data',
        requirements: 'Topic research: keyword volume, competition, top 10 ranking articles, content gap analysis.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 1: Topic Research.\nFind: (1) primary keyword + 5 secondary keywords with monthly search volume, (2) top 10 ranking articles (title + word count + main points), (3) content gap analysis (what they miss). Return a structured research report.`,
      },
      {
        stage: 2, team: 'aurora', leader: 'aurora', name: 'Content Outline',
        artifactType: 'data',
        requirements: 'Content outline: H1/H2/H3 structure, target word count, key points per section, SEO meta title + description.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 2: Content Outline.\nDesign: (1) H1/H2/H3 outline (at least 8 H2 sections), (2) target word count, (3) key points per section, (4) SEO meta title (under 60 chars) + meta description (under 160 chars), (5) internal/external link suggestions.`,
      },
      {
        stage: 3, team: 'quill', leader: 'quill', name: 'Content Draft',
        artifactType: 'data',
        requirements: 'Full content draft (2000+ words), formatted in markdown, ready for publication.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 3: Content Draft.\nWrite the full article (2000+ words) in markdown based on Aurora's outline. Include: (1) engaging intro (hook + thesis), (2) all H2 sections fully written, (3) examples / data / quotes where relevant, (4) call-to-action at the end, (5) suggested images (alt text + description).`,
      },
      {
        stage: 4, team: 'echo', leader: 'echo', name: 'Editorial Review',
        artifactType: 'data',
        requirements: 'Edited content + review notes. Grammar, clarity, SEO checklist, plagiarism check.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: Editorial Review.\nReview Nova's draft: (1) grammar / spelling fixes, (2) clarity improvements, (3) SEO checklist (keyword density, headers, meta), (4) plagiarism / originality check, (5) fact-check claims. Return the edited draft + a review notes section.`,
      },
      {
        stage: 5, team: 'pulse', leader: 'pulse', name: 'Publish & Monitor',
        artifactType: 'url',
        requirements: 'Published URL (HTTP 200). Set up monitoring (GA4, Search Console).',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 5: Publish & Monitor.\nPublish the edited content (use WordPress or other publisher tool). Return: (1) live URL, (2) GA4 tracking ID, (3) Search Console submission status, (4) social media auto-post schedule. The URL MUST return HTTP 200.`,
      },
      {
        stage: 6, team: 'ceo', leader: 'ceo', name: 'CEO Final Report',
        artifactType: 'none',
        requirements: 'CEO aggregates everything into an executive report.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 6 (FINAL): CEO Executive Report.\nAs CEO, aggregate all stage outputs into a single executive summary for Antonio.`,
      },
    ],
  },

  affiliate_campaign: {
    type: 'affiliate_campaign',
    name: 'Affiliate Campaign',
    description: 'Niche research → affiliate signup → content → traffic → CEO report',
    requiresOwnerApproval: false,
    stages: [
      {
        stage: 1, team: 'scout', leader: 'scout', name: 'Niche & Affiliate Research',
        artifactType: 'data',
        requirements: 'Niche analysis: 5 affiliate programs with commission rates, cookie duration, EPC, top-performing content formats.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 1: Niche & Affiliate Research.\nFind: (1) 5 affiliate programs in the niche with commission %, cookie duration, EPC, (2) top 3 content formats that convert (review, comparison, tutorial), (3) competitor affiliate sites (top 5), (4) recommended angle / positioning. Return a structured research report.`,
      },
      {
        stage: 2, team: 'aurora', leader: 'aurora', name: 'Campaign Strategy',
        artifactType: 'data',
        requirements: 'Campaign strategy: content calendar (12 articles), keyword targets per article, internal linking plan, funnel design.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 2: Campaign Strategy.\nDesign: (1) content calendar (12 articles over 90 days), (2) primary + secondary keyword targets per article, (3) internal linking plan (which articles link to which), (4) funnel design (traffic → email list → affiliate CTA), (5) projected revenue (commission × conversion rate × traffic).`,
      },
      {
        stage: 3, team: 'quill', leader: 'quill', name: 'First 3 Articles Drafted',
        artifactType: 'data',
        requirements: '3 full article drafts (1500+ words each), each with affiliate CTAs and proper disclosure.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 3: First 3 Articles.\nWrite 3 full article drafts (1500+ words each) following Aurora's content calendar. Each article: (1) engaging intro, (2) affiliate CTAs (in-content + sidebar suggestion), (3) proper affiliate disclosure, (4) comparison tables where relevant, (5) FAQ section.`,
      },
      {
        stage: 4, team: 'echo', leader: 'echo', name: 'QA & SEO Audit',
        artifactType: 'data',
        requirements: 'Edited articles + SEO audit. Grammar, affiliate disclosure compliance, SEO checklist.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: QA & SEO Audit.\nReview the 3 articles: (1) grammar / spelling, (2) affiliate disclosure compliance (FTC), (3) SEO checklist per article (meta, headers, keyword density, internal links), (4) affiliate link format (no-follow / sponsored), (5) plagiarism / originality. Return edited articles + audit notes.`,
      },
      {
        stage: 5, team: 'pulse', leader: 'pulse', name: 'Publish & Traffic Plan',
        artifactType: 'url',
        requirements: 'Published URLs (HTTP 200). Traffic plan with social / forum / email promotion schedule.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 5: Publish & Traffic Plan.\nPublish all 3 articles. Return: (1) 3 live URLs (HTTP 200), (2) traffic plan (social posts, forum mentions, email outreach, Pinterest if visual), (3) tracking setup (UTM params, GA4).`,
      },
      {
        stage: 6, team: 'ceo', leader: 'ceo', name: 'CEO Final Report',
        artifactType: 'none',
        requirements: 'CEO aggregates everything into an executive report.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 6 (FINAL): CEO Executive Report.\nAs CEO, aggregate all stage outputs into a single executive summary for Antonio.`,
      },
    ],
  },

  generic: {
    type: 'generic',
    name: 'Generic Mission',
    description: 'Scout → Aurora → Nova → Echo → Pulse → CEO. Default pipeline when no specific type matches.',
    requiresOwnerApproval: false,
    stages: [
      {
        stage: 1, team: 'scout', leader: 'scout', name: 'Research',
        artifactType: 'data',
        requirements: 'Research report with at least 3 concrete data points relevant to the mission.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 1: Research.\nInvestigate this mission. Find: (1) what's been tried before, (2) what works / what doesn't, (3) 3+ concrete data points (numbers, URLs, quotes). Return a structured research report.`,
      },
      {
        stage: 2, team: 'aurora', leader: 'aurora', name: 'Strategy',
        artifactType: 'data',
        requirements: 'Strategy document with actionable steps, success metrics, and risk mitigation.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 2: Strategy.\nBased on Scout's research, design: (1) step-by-step strategy, (2) success metrics (KPIs), (3) risk mitigation, (4) timeline. Be specific and actionable.`,
      },
      {
        stage: 3, team: 'forge', leader: 'forge', name: 'Execution',
        artifactType: 'data',
        requirements: 'Concrete execution output — the actual deliverable (content, code, plan).',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 3: Execution.\nExecute Aurora's strategy. Produce the actual deliverable. Return: (1) the deliverable itself, (2) notes on what was built, (3) any deviations from the strategy and why.`,
      },
      {
        stage: 4, team: 'echo', leader: 'echo', name: 'QA',
        artifactType: 'data',
        requirements: 'QA report: tested against requirements, bugs found, fix recommendations, go/no-go.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: QA.\nReview Nova's execution: (1) does it meet the strategy requirements? (2) bugs / issues found, (3) fix recommendations, (4) go / no-go recommendation. Be honest — Antonio trusts the QA.`,
      },
      {
        stage: 5, team: 'pulse', leader: 'pulse', name: 'Deployment',
        artifactType: 'url',
        requirements: 'Live URL or delivered artifact. Must be verifiable (HTTP 200 for URLs).',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 5: Deployment.\nDeploy / deliver Nova's execution. Return: (1) live URL or delivered artifact reference, (2) monitoring setup, (3) any post-deployment tasks. The URL / artifact MUST be verifiable.`,
      },
      {
        stage: 6, team: 'ceo', leader: 'ceo', name: 'CEO Final Report',
        artifactType: 'none',
        requirements: 'CEO aggregates everything into an executive report.',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 6 (FINAL): CEO Executive Report.\nAs CEO, aggregate all stage outputs into a single executive summary for Antonio.`,
      },
    ],
  },
}

// ──────────────────────────────────────────────────────────────────
// PIPELINE RUNNER
// ──────────────────────────────────────────────────────────────────

export interface PipelineRunResult {
  missionId: string
  pipelineType: string
  success: boolean
  stages: MissionStageSummary[]
  ceoReport?: any  // CeoReport — typed as any to avoid import cycle
  error?: string
  requiresOwnerApproval?: boolean
  pausedForOwnerApproval?: boolean
}

const MAX_ROUNDS_PER_STAGE = 3

/**
 * Run a single team leader with the Super Agent verification loop.
 * Returns the final approved output + verification metadata.
 */
async function runTeamWithVerificationLoop(opts: {
  missionId: string
  stage: PipelineStage
  objective: string
  missionContext: string
  previousTeamOutput?: string
}): Promise<{
  output: string
  rounds: number
  finalScore: number
  finalVerification: VerificationResult
  artifactValue: string | null
  artifactVerified: boolean
}> {
  const { missionId, stage, objective, missionContext, previousTeamOutput } = opts
  let currentPrompt = stage.promptTemplate(objective)
  let lastVerification: VerificationResult | null = null
  let teamOutput = ''

  for (let round = 1; round <= MAX_ROUNDS_PER_STAGE; round++) {
    // ── Notify: stage start (round 1 only)
    if (round === 1) {
      await notifyTelegram(`🚀 Stage ${stage.stage}/${stage.team} STARTED\nMission: ${missionId}\nObjective: ${objective.slice(0, 100)}`)
      await logApprovalEvent({
        missionId,
        stageId: `stage_${stage.stage}`,
        round,
        agentRole: 'team_leader',
        agentId: stage.leader,
        action: 'started',
        feedback: `Stage ${stage.stage} (${stage.name}) started by ${stage.leader}`,
      })
    } else {
      // Retry round — note in audit log
      await logApprovalEvent({
        missionId,
        stageId: `stage_${stage.stage}`,
        round,
        agentRole: 'team_leader',
        agentId: stage.leader,
        action: 'retry_submitted',
        feedback: `Round ${round}: team re-submitting after Super Agent feedback`,
      })
    }

    // ── Run the team leader
    // Special case: CEO stage uses callLlmWithRetry directly (no 'ceo' subagent exists).
    // The CEO is the apex LLM that aggregates everything into a final executive report.
    if (stage.team === 'ceo') {
      try {
        const { callLlmWithRetry } = await import('./agent')
        const ceoResponse = await callLlmWithRetry([
          {
            role: 'system',
            content: `You are the CEO of Agent007 — the apex executive reporting to the human owner (Antonio).

A mission has just completed all of its team stages. Your job: AGGREGATE everything the teams produced and present a CLEAR, EXECUTIVE summary to Antonio.

Antonio is busy. He needs to understand:
1. Did the mission succeed? (success / partial / failed)
2. What was actually delivered? (URLs, files, transaction IDs — concrete artifacts, not promises)
3. What is the revenue impact? (if applicable)
4. What risks or notes should he be aware of?
5. What are the next 3 recommended actions?

FORMAT (strict):
🎯 MISSION: [one-line description]
📊 OUTCOME: [success/partial/failed]
💰 REVENUE IMPACT: [if applicable, otherwise "N/A"]
✅ KEY DELIVERABLES:
   - [bullet list with URLs/IDs]
⚠️ RISKS/NOTES:
   - [if any, otherwise "None"]
📈 NEXT STEPS:
   1. [action]
   2. [action]
   3. [action]

RULES:
- Keep the report under 300 words.
- Be honest — if delivery failed, say so. Antonio trusts the CEO because the CEO never lies.
- Quote real artifact values (URLs, IDs), not vague descriptions.
- If revenue is $0, say "$0 so far — see next steps for monetization plan".`
          },
          { role: 'user', content: currentPrompt },
        ], { thinking: false })

        teamOutput = typeof ceoResponse === 'string'
          ? ceoResponse
          : (ceoResponse?.content ?? ceoResponse?.message?.content ?? '(CEO produced no output)')
      } catch (ceoErr: any) {
        teamOutput = `🎯 MISSION: ${objective.slice(0, 100)}\n📊 OUTCOME: partial (CEO LLM unavailable)\n💰 REVENUE IMPACT: See artifacts below\n✅ KEY DELIVERABLES:\n   - (See stage results in audit trail)\n⚠️ RISKS/NOTES:\n   - CEO LLM was unavailable; this is a fallback report.\n📈 NEXT STEPS:\n   1. Review the audit trail manually.\n   2. Approve mission via dashboard.\n   3. Schedule the next mission.`
      }
    } else {
      const result = await runSubagent({
        subagentId: stage.leader,
        task: currentPrompt,
        attachments: [],
        language: 'en',
        emit: async () => {},  // silent — pipeline runs in background
        parentConversationId: `mission_${missionId}`,
        dispatchId: `pipeline_${missionId}_stage${stage.stage}_round${round}`,
      })
      teamOutput = result.answer
    }

    // ── Special case: CEO stage doesn't get verified (it IS the verifier of the whole mission)
    if (stage.team === 'ceo') {
      await logApprovalEvent({
        missionId,
        stageId: `stage_${stage.stage}`,
        round,
        agentRole: 'ceo',
        agentId: 'ceo',
        action: 'submitted',
        feedback: teamOutput.slice(0, 500),
        score: 100,
      })
      return {
        output: teamOutput,
        rounds: round,
        finalScore: 100,
        finalVerification: {
          approved: true,
          verdict: 'APPROVED',
          score: 100,
          strengths: ['CEO final report — apex of mission'],
          weaknesses: [],
          corrections: [],
          summary: 'CEO stage auto-approved',
        },
        artifactValue: null,
        artifactVerified: true,
      }
    }

    // ── Log submission to audit trail
    await logApprovalEvent({
      missionId,
      stageId: `stage_${stage.stage}`,
      round,
      agentRole: 'team_leader',
      agentId: stage.leader,
      action: 'submitted',
      feedback: teamOutput.slice(0, 500),
    })

    // ── Super Agent verifies
    lastVerification = await superAgentVerify({
      teamOutput,
      missionContext,
      stageRequirements: stage.requirements,
      previousTeamOutput,
      round,
      maxRounds: MAX_ROUNDS_PER_STAGE,
    })

    // ── Log verification result to audit trail
    await logApprovalEvent({
      missionId,
      stageId: `stage_${stage.stage}`,
      round,
      agentRole: 'super_agent',
      agentId: 'super_agent',
      action: lastVerification.approved ? 'approved' : 'rejected',
      score: lastVerification.score,
      feedback: formatVerificationResult(lastVerification).slice(0, 1000),
    })

    // ── Approved → done
    if (lastVerification.approved) {
      await notifyTelegram(`✅ Stage ${stage.stage} (${stage.team}) APPROVED\nScore: ${lastVerification.score}/100, ${round} round(s)`)
      break
    }

    // ── Notify rejection
    await notifyTelegram(`⚠️ Stage ${stage.stage} (${stage.team}) ${lastVerification.verdict}\nScore: ${lastVerification.score}/100, round ${round}/${MAX_ROUNDS_PER_STAGE}\nCorrections: ${lastVerification.corrections.length}`)

    // ── Last round exhausted — break out, mission will escalate
    if (round === MAX_ROUNDS_PER_STAGE) {
      await logApprovalEvent({
        missionId,
        stageId: `stage_${stage.stage}`,
        round,
        agentRole: 'super_agent',
        agentId: 'super_agent',
        action: 'escalated',
        feedback: `Stage failed after ${MAX_ROUNDS_PER_STAGE} rounds — escalating to CEO`,
      })
      await notifyTelegram(`❌ Stage ${stage.stage} ESCALATED\nFailed after ${MAX_ROUNDS_PER_STAGE} rounds. CEO will note in final report.`)
      break
    }

    // ── Build retry prompt for next round
    currentPrompt = buildRetryPrompt(
      stage.promptTemplate(objective),
      lastVerification,
      round + 1,
      MAX_ROUNDS_PER_STAGE
    )
  }

  // ── Extract artifact from team output (best-effort)
  const artifactValue = extractArtifact(teamOutput, stage.artifactType)
  const artifactVerified = artifactValue !== null && lastVerification?.approved === true

  return {
    output: teamOutput,
    rounds: lastVerification ? (lastVerification.approved ? 1 : MAX_ROUNDS_PER_STAGE) : 1,
    finalScore: lastVerification?.score ?? 0,
    finalVerification: lastVerification ?? {
      approved: false,
      verdict: 'REJECTED',
      score: 0,
      strengths: [],
      weaknesses: ['No verification performed'],
      corrections: [],
      summary: 'Verification skipped',
    },
    artifactValue,
    artifactVerified,
  }
}

/**
 * Best-effort extract an artifact (URL, transaction ID, etc.) from the team's output.
 * Looks for common patterns.
 */
function extractArtifact(output: string, type: PipelineStage['artifactType']): string | null {
  if (type === 'none') return null
  if (type === 'url') {
    // Find first http(s) URL that looks like a deliverable (not example.com)
    const urlMatch = output.match(/https?:\/\/(?!example\.com|localhost|example\.org)[^\s<>"')\]]+/i)
    return urlMatch ? urlMatch[0] : null
  }
  if (type === 'transaction_id') {
    // Stripe-style IDs (ch_, pi_, txn_, etc.)
    const txMatch = output.match(/\b(ch|pi|txn|sub|in)_[A-Za-z0-9]{10,}\b/)
    return txMatch ? txMatch[0] : null
  }
  if (type === 'message_id') {
    // Telegram / Discord-style message IDs
    const msgMatch = output.match(/\bmsg[_-]?(\d{6,})\b/i) || output.match(/\b(\d{10,})\b/)
    return msgMatch ? msgMatch[0] : null
  }
  if (type === 'file_path') {
    // Path-like strings
    const pathMatch = output.match(/(?:^|\s)(\/[\w./-]+\.\w+)/) || output.match(/([\w-]+\.(?:js|ts|tsx|jsx|py|md|json|html|css))/)
    return pathMatch ? pathMatch[1] : null
  }
  if (type === 'data') {
    // For data artifacts, return the first 500 chars as the "artifact"
    return output.slice(0, 500) || null
  }
  return null
}

/**
 * Check if owner has approved a high-stakes mission.
 * Rec 7 — polls the approval-audit-log for an 'owner_approved' event.
 */
async function waitForOwnerApproval(missionId: string, timeoutMs: number = 24 * 60 * 60 * 1000): Promise<boolean> {
  const startTime = Date.now()
  const pollInterval = 60 * 1000  // check every minute

  await notifyTelegram(`⏸️ MISSION REQUIRES OWNER APPROVAL\nMission: ${missionId}\n\nThis is a high-stakes mission. Reply with /approve_${missionId.slice(0, 8)} to proceed, or /reject_${missionId.slice(0, 8)} to cancel.\n\nAuto-cancel in 24 hours if no response.`)

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { hasOwnerApproval } = await import('./approval-audit-log')
      const approved = await hasOwnerApproval(missionId)
      if (approved) return true

      // Check for explicit rejection
      const { hasOwnerRejection } = await import('./approval-audit-log')
      const rejected = await hasOwnerRejection(missionId)
      if (rejected) return false
    } catch {}

    await new Promise((r) => setTimeout(r, pollInterval))
  }

  await notifyTelegram(`⏰ MISSION AUTO-CANCELLED\nMission: ${missionId}\nReason: owner did not respond within 24 hours.`)
  return false
}

/**
 * Run the full mission pipeline end-to-end.
 *
 * This is the MAIN ENTRY POINT. Called by:
 *   - The orchestrator when it detects a "mission" task
 *   - The /api/mission-active/run endpoint (manual trigger)
 *   - The scheduled tick (for autonomous missions)
 */
export async function runMissionPipeline(opts: {
  missionId: string
  pipelineType: string
  objective: string
  missionTitle?: string
  skipOwnerApproval?: boolean  // for testing only
}): Promise<PipelineRunResult> {
  const { missionId, pipelineType, objective } = opts

  const pipeline = MISSION_PIPELINES[pipelineType] ?? MISSION_PIPELINES.generic
  const stages: MissionStageSummary[] = []

  // ── Rec 7: Owner approval gate for high-stakes missions
  if (pipeline.requiresOwnerApproval && !opts.skipOwnerApproval) {
    await notifyTelegram(`🎯 MISSION STARTED: ${opts.missionTitle ?? missionId}\nPipeline: ${pipeline.name}\nStages: ${pipeline.stages.length}\n⚠️ This mission requires your approval before final execution.`)
  } else {
    await notifyTelegram(`🎯 MISSION STARTED: ${opts.missionTitle ?? missionId}\nPipeline: ${pipeline.name}\nStages: ${pipeline.stages.length}`)
  }

  // Build mission context (grows as stages complete)
  let missionContext = `MISSION OBJECTIVE: ${objective}\n\n`
  let previousTeamOutput: string | undefined

  // ── Run each stage sequentially
  for (const stage of pipeline.stages) {
    try {
      const result = await runTeamWithVerificationLoop({
        missionId,
        stage,
        objective,
        missionContext,
        previousTeamOutput,
      })

      const stageSummary: MissionStageSummary = {
        stage: stage.stage,
        team: stage.team,
        leader: stage.leader,
        artifactValue: result.artifactValue,
        artifactVerified: result.artifactVerified,
        finalScore: result.finalScore,
        rounds: result.rounds,
        approvedAt: result.finalVerification.approved ? new Date().toISOString() : null,
      }
      stages.push(stageSummary)

      // Update mission context with this stage's output
      missionContext += `STAGE ${stage.stage} (${stage.team}/${stage.leader}) OUTPUT:\n${result.output.slice(0, 3000)}\n\nFINAL SCORE: ${result.finalScore}/100\nVERDICT: ${result.finalVerification.verdict}\n\n---\n\n`
      previousTeamOutput = result.output

      // If stage is the CEO (final), capture the report
      if (stage.team === 'ceo') {
        // CEO stage output IS the report
        const ceoReport: import('./ceo-presenter').CeoReport = {
          missionId,
          missionTitle: opts.missionTitle ?? missionId,
          objective,
          outcome: stages.every((s) => s.artifactVerified || s.team === 'ceo') ? 'success' : 'partial',
          revenueImpact: 'See full report',
          keyDeliverables: stages.filter((s) => s.artifactValue).map((s) => `Stage ${s.stage} (${s.team}): ${s.artifactValue}`),
          risksNotes: [],
          nextSteps: ['Review CEO report', 'Approve mission via dashboard', 'Schedule follow-up'],
          fullReport: result.output,
          generatedAt: new Date().toISOString(),
        }

        // Send CEO report via Telegram (the CEO's output is already a formatted report)
        await notifyTelegram(`🎯 MISSION COMPLETE — CEO REPORT\n\n${result.output.slice(0, 3500)}\n\n— Agent007 CEO`)

        // Persist to DB
        try {
          const { ceoPersistReport } = await import('./ceo-presenter')
          await ceoPersistReport(ceoReport)
        } catch {}

        return {
          missionId,
          pipelineType: pipeline.type,
          success: true,
          stages,
          ceoReport,
        }
      }
    } catch (stageErr: any) {
      // Stage crashed — log + abort
      await logApprovalEvent({
        missionId,
        stageId: `stage_${stage.stage}`,
        round: 1,
        agentRole: 'system',
        agentId: 'system',
        action: 'escalated',
        feedback: `Stage crashed: ${stageErr?.message?.slice(0, 200)}`,
      })
      await notifyTelegram(`❌ MISSION FAILED at stage ${stage.stage} (${stage.team})\nError: ${stageErr?.message?.slice(0, 200)}`)

      return {
        missionId,
        pipelineType: pipeline.type,
        success: false,
        stages,
        error: `Stage ${stage.stage} (${stage.team}) crashed: ${stageErr?.message ?? 'unknown'}`,
      }
    }
  }

  // ── Rec 7: Owner approval gate (only for high-stakes missions that completed successfully)
  if (pipeline.requiresOwnerApproval && !opts.skipOwnerApproval) {
    const approved = await waitForOwnerApproval(missionId)
    if (!approved) {
      return {
        missionId,
        pipelineType: pipeline.type,
        success: false,
        stages,
        error: 'Owner did not approve the mission',
        requiresOwnerApproval: true,
        pausedForOwnerApproval: true,
      }
    }
  }

  return {
    missionId,
    pipelineType: pipeline.type,
    success: true,
    stages,
  }
}

/**
 * List available pipeline types (for dashboard UI).
 */
export function listPipelineTypes(): Array<{ type: string; name: string; description: string; stages: number }> {
  return Object.values(MISSION_PIPELINES).map((p) => ({
    type: p.type,
    name: p.name,
    description: p.description,
    stages: p.stages.length,
  }))
}
