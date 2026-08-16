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
import { type MissionStageSummary } from './ceo-presenter'
import { logApprovalEvent } from './approval-audit-log'
import {
  notifyStageStarted,
  notifyStageApproved,
  notifyStageRejected,
  notifyStageEscalated,
  notifyMissionStarted,
  notifyMissionFailed,
  notifyOwnerApprovalRequired,
} from './mission-notifier'
import { saveHeartbeat, buildHeartbeatFromAuditLog, type MissionHeartbeat } from './mission-heartbeat'
import { registerArtifact, verifyArtifact, handoffArtifact } from './artifact-ledger'
import { getParentId } from './hierarchy-control'

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
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: Build & Deploy.\nBuild the MVP according to Vertex's blueprint (Stage 3). Deploy to Vercel. Return: (1) live URL, (2) GitHub repo URL, (3) list of features implemented, (4) any features deferred to post-MVP. The URL MUST return HTTP 200.`,
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
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: Editorial Review.\nReview Quill's draft (Stage 3): (1) grammar / spelling fixes, (2) clarity improvements, (3) SEO checklist (keyword density, headers, meta), (4) plagiarism / originality check, (5) fact-check claims. Return the edited draft + a review notes section.`,
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
    description: 'Scout → Aurora → Forge → Echo → Pulse → CEO. Default pipeline when no specific type matches.',
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
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 4: QA.\nReview Forge's execution (Stage 3): (1) does it meet the strategy requirements? (2) bugs / issues found, (3) fix recommendations, (4) go / no-go recommendation. Be honest — Antonio trusts the QA.`,
      },
      {
        stage: 5, team: 'pulse', leader: 'pulse', name: 'Deployment',
        artifactType: 'url',
        requirements: 'Live URL or delivered artifact. Must be verifiable (HTTP 200 for URLs).',
        promptTemplate: (obj) => `MISSION: ${obj}\n\nStage 5: Deployment.\nDeploy / deliver Forge's execution (Stage 3). Return: (1) live URL or delivered artifact reference, (2) monitoring setup, (3) any post-deployment tasks. The URL / artifact MUST be verifiable.`,
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
  previousArtifactId?: string
}): Promise<{
  output: string
  rounds: number
  finalScore: number
  finalVerification: VerificationResult
  artifactValue: string | null
  artifactVerified: boolean
  artifactId?: string
}> {
  const { missionId, stage, objective, missionContext, previousTeamOutput } = opts
  let currentPrompt = stage.promptTemplate(objective)
  let lastVerification: VerificationResult | null = null
  let teamOutput = ''
  let lastRound = 1  // UPGRADE #146 — hoisted out of for-loop so we can report actual rounds

  for (let round = 1; round <= MAX_ROUNDS_PER_STAGE; round++) {
    lastRound = round
    // ── Notify: stage start (round 1 only)
    if (round === 1) {
      // UPGRADE #147 — use specific notification function (not generic)
      await notifyStageStarted(missionId, stage.stage, stage.team, stage.name)
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
        parentAgentId: getParentId(stage.leader) ?? 'vid',
        missionId,
        ventureId: undefined,
        parentArtifactId: opts.previousArtifactId,
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
      let ceoArtifactId: string | undefined
      try {
        const artifact = await registerArtifact({
          missionId, stageId: `stage_${stage.stage}`, artifactType: 'executive_report',
          parentArtifactId: opts.previousArtifactId,
          name: stage.name, producerAgentId: 'ceo', sourceRef: `mission:${missionId}:stage:${stage.stage}`,
          content: teamOutput, artifactValue: teamOutput.slice(0, 4000), status: 'verified',
          verificationScore: 100, verifiedBy: 'ceo', verifiedAt: new Date(),
        })
        ceoArtifactId = artifact.artifactId
      } catch (artifactError: any) {
        throw new Error(`CEO artifact registration failed: ${String(artifactError?.message ?? artifactError).slice(0, 300)}`)
      }

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
        artifactId: ceoArtifactId,
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
      // UPGRADE #147 — use specific notification function (not generic)
      await notifyStageApproved(missionId, stage.stage, stage.team, lastVerification.score, round)
      break
    }

    // ── Notify rejection
    // UPGRADE #147 — use specific notification function (not generic)
    await notifyStageRejected(missionId, stage.stage, stage.team, lastVerification.score, round, MAX_ROUNDS_PER_STAGE, lastVerification.corrections.length)

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
      // UPGRADE #147 — use specific notification function (not generic)
      await notifyStageEscalated(missionId, stage.stage, stage.team, MAX_ROUNDS_PER_STAGE)
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
  const artifactVerified = stage.artifactType === 'none' || (artifactValue !== null && lastVerification?.approved === true)
  let artifactId: string | undefined
  try {
    const artifact = await registerArtifact({
      missionId, stageId: `stage_${stage.stage}`, artifactType: stage.artifactType,
      name: stage.name, producerAgentId: stage.leader, sourceRef: `mission:${missionId}:stage:${stage.stage}:round:${lastRound}`,
      artifactValue, content: teamOutput, status: artifactVerified ? 'verified' : 'rejected',
      verificationScore: artifactVerified ? (lastVerification?.score ?? 0) : 0, verifiedBy: artifactVerified ? 'super_agent' : undefined,
      verifiedAt: artifactVerified && lastVerification ? new Date() : undefined, metadata: { round: lastRound },
    })
    artifactId = artifact.artifactId
    if (artifactVerified) await verifyArtifact(artifactId, lastVerification?.score ?? 0, 'super_agent', 'verified')
  } catch (artifactError: any) {
    throw new Error(`Artifact ledger registration failed for stage ${stage.stage}: ${String(artifactError?.message ?? artifactError).slice(0, 300)}`)
  }

  // UPGRADE #146 (Warning fix) — `rounds` should report the ACTUAL round count,
  // not "1 if approved, MAX if not". The previous logic reported 1 even when
  // approval happened on round 2 or 3, hiding retry info from the dashboard.
  // `lastRound` is hoisted out of the for-loop and tracks the last round that
  // actually executed. If we exited via break on approval, `lastRound` is the
  // approval round. If we exited via the loop condition, `lastRound` equals MAX.
  return {
    output: teamOutput,
    rounds: lastRound,
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
    artifactId,
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
 * UPGRADE #146 (Critical #1 + #3 fix) — Non-blocking owner approval gate.
 *
 * Before: `waitForOwnerApproval` polled in a `while` loop for 24 hours. On
 * Vercel this is impossible (maxDuration is 60-300s) — the function would
 * always time out before the owner responded.
 *
 * After: This function is now FIRE-AND-FORGET. It:
 *   1. Sends a Telegram notification asking for approval
 *   2. Persists the mission as `paused_owner` in the heartbeat
 *   3. Returns immediately
 *
 * The owner approves via:
 *   - POST /api/missions/[id]/approve { decision: 'approve' }
 *   - Telegram /approve_XXXXXXXX command
 *
 * When approval arrives, a SEPARATE trigger (cron, dashboard button, or
 * /api/missions/run with resume=true) re-invokes runMissionPipeline with
 * `skipOwnerApproval: true` to resume the remaining stages.
 *
 * This is the only correct pattern on serverless — long-running polls
 * belong in the client or in a queue worker, not in the request handler.
 */
async function requestOwnerApproval(missionId: string, missionTitle: string): Promise<void> {
  const approveCmd = `/approve_${missionId.slice(0, 8)}`
  const rejectCmd = `/reject_${missionId.slice(0, 8)}`

  // UPGRADE #147 — use specific notification function (not generic)
  await notifyOwnerApprovalRequired(missionId, missionTitle, approveCmd, rejectCmd)

  // Mark the heartbeat as paused so the dashboard shows the right status
  try {
    const { loadHeartbeat, saveHeartbeat } = await import('./mission-heartbeat')
    const hb = await loadHeartbeat(missionId)
    if (hb) {
      hb.status = 'paused_owner'
      hb.ceoWatchdog = {
        verdict: 'warning',
        message: 'Paused — waiting for owner approval. Use /approve_XXXXXXXX or dashboard button.',
        checkedAt: new Date().toISOString(),
      }
      hb.updatedAt = new Date().toISOString()
      await saveHeartbeat(hb)
    }
  } catch {}
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

  // UPGRADE #144 + #147 — Initialize heartbeat (real-time monitoring + resume support)
  const initialHeartbeat: MissionHeartbeat = {
    missionId,
    missionTitle: opts.missionTitle ?? missionId,
    pipelineType: pipeline.type,
    // UPGRADE #147 — persist objective + approval flag so resume can use them
    objective,
    requiresOwnerApproval: !!pipeline.requiresOwnerApproval,
    status: 'working',
    currentStage: {
      stageId: `stage_1`,
      stageNumber: 1,
      totalStages: pipeline.stages.length,
      name: pipeline.stages[0].name,
      team: pipeline.stages[0].team,
      leader: pipeline.stages[0].leader,
      startedAt: new Date().toISOString(),
      elapsedMs: 0,
      round: 1,
      maxRounds: 3,
    },
    completedStages: [],
    estimatedRemainingMs: null,
    estimatedCompletionAt: null,
    lastActivityAt: new Date().toISOString(),
    lastError: null,
    ceoWatchdog: { verdict: 'healthy', message: 'Mission started', checkedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  }
  await saveHeartbeat(initialHeartbeat).catch(() => {})

  // ── Rec 7: Owner approval gate for high-stakes missions
  // UPGRADE #147 — use specific notification function (not generic)
  await notifyMissionStarted(missionId, opts.missionTitle ?? missionId, pipeline.name, pipeline.stages.length)

  // Build mission context (grows as stages complete)
  let missionContext = `MISSION OBJECTIVE: ${objective}\n\n`
  let previousTeamOutput: string | undefined
  let previousArtifactId: string | undefined

  // ── Run each stage sequentially
  // UPGRADE #147 (Rec A — Resume) — Load the audit log ONCE at the start so we
  // can skip stages that were already completed in a prior run. This makes the
  // pipeline idempotent: re-running it (e.g. after owner approval) picks up
  // where it left off instead of re-doing completed stages.
  let previouslyCompletedStages: Set<string> = new Set()
  try {
    const priorArtifacts = await import('./artifact-ledger').then(({ listMissionArtifacts }) => listMissionArtifacts(missionId))
    const latestVerifiedArtifact = [...priorArtifacts].reverse().find((artifact) => artifact.status === 'verified' || artifact.status === 'handed_off')
    if (latestVerifiedArtifact) {
      previousArtifactId = latestVerifiedArtifact.artifactId
      previousTeamOutput = latestVerifiedArtifact.artifactValue ?? undefined
    }
  } catch {}
  try {
    const { loadApprovalLog } = await import('./approval-audit-log')
    const priorLog = await loadApprovalLog(missionId)
    previouslyCompletedStages = new Set(
      priorLog
        .filter((e) => e.action === 'approved' || e.action === 'completed')
        .map((e) => e.stageId)
    )
    // Also reconstruct missionContext from prior stage outputs (stored in the
    // 'submitted' audit entries' feedback field) so the CEO stage has the full
    // context even when resuming.
    if (previouslyCompletedStages.size > 0) {
      for (const entry of priorLog) {
        if (entry.action === 'submitted' && previouslyCompletedStages.has(entry.stageId)) {
          missionContext += `STAGE ${entry.stageId} OUTPUT (from prior run):\n${(entry.feedback ?? '').slice(0, 3000)}\n\n---\n\n`
        }
      }
    }
  } catch {}

  for (const stage of pipeline.stages) {
    // UPGRADE #147 (Rec A — Resume) — Skip stages that were already completed.
    // This is the key to making resume work: when the pipeline is re-invoked
    // after owner approval, all stages except the CEO (which was gated) are
    // already in the audit log as 'approved', so they get skipped and only
    // the CEO stage actually runs.
    const stageId = `stage_${stage.stage}`
    if (previouslyCompletedStages.has(stageId) && stage.team !== 'ceo') {
      // Add a placeholder stage summary from the audit log
      try {
        const { loadApprovalLog } = await import('./approval-audit-log')
        const log = await loadApprovalLog(missionId)
        const approvedEntry = log.find((e) => e.stageId === stageId && e.action === 'approved')
        if (approvedEntry) {
          stages.push({
            stage: stage.stage,
            team: stage.team,
            leader: stage.leader,
            artifactValue: null,
            artifactVerified: true,
            finalScore: approvedEntry.score ?? 100,
            rounds: approvedEntry.round,
            approvedAt: approvedEntry.timestamp,
          })
        }
      } catch {}
      continue
    }

    // UPGRADE #146 (Critical #1 fix) — Owner approval gate BEFORE the CEO stage.
    // Previously this gate was at the END of the loop, but the CEO stage early-returns
    // from inside the loop, so the gate was unreachable. Now we check BEFORE the CEO
    // stage runs: if approval is required and not yet granted, pause the mission
    // and return immediately so the request can finish within Vercel's timeout.
    if (stage.team === 'ceo' && pipeline.requiresOwnerApproval && !opts.skipOwnerApproval) {
      // Check if owner already approved (e.g. mission was resumed)
      try {
        const { hasOwnerApproval, hasOwnerRejection } = await import('./approval-audit-log')
        const alreadyApproved = await hasOwnerApproval(missionId)
        const alreadyRejected = await hasOwnerRejection(missionId)
        if (alreadyRejected) {
          return {
            missionId,
            pipelineType: pipeline.type,
            success: false,
            stages,
            error: 'Owner rejected the mission',
            requiresOwnerApproval: true,
            pausedForOwnerApproval: false,
          }
        }
        if (!alreadyApproved) {
          // Pause — send Telegram, mark heartbeat, return immediately.
          await requestOwnerApproval(missionId, opts.missionTitle ?? missionId)
          return {
            missionId,
            pipelineType: pipeline.type,
            success: false,
            stages,
            error: 'Mission paused — waiting for owner approval',
            requiresOwnerApproval: true,
            pausedForOwnerApproval: true,
          }
        }
        // Already approved → fall through and run CEO stage
      } catch (e: any) {
        // Approval-check failed — proceed with CEO (fail-open to avoid mission stall)
        console.warn('[mission-pipeline] Owner approval check failed, proceeding:', e?.message?.slice(0, 100))
      }
    }

    try {
      const result = await runTeamWithVerificationLoop({
        missionId,
        stage,
        objective,
        missionContext,
        previousTeamOutput,
        previousArtifactId,
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

      // UPGRADE #144 — Update heartbeat after each stage
      try {
        const hb = await buildHeartbeatFromAuditLog({
          missionId,
          missionTitle: opts.missionTitle ?? missionId,
          pipelineType: pipeline.type,
          totalStages: pipeline.stages.length,
          objective,
          requiresOwnerApproval: !!pipeline.requiresOwnerApproval,
        })
        // If this wasn't the last stage, set current stage to next one
        if (stage.stage < pipeline.stages.length) {
          const nextStage = pipeline.stages[stage.stage]  // 0-indexed; stage.stage is 1-indexed
          if (nextStage && !hb.currentStage) {
            hb.currentStage = {
              stageId: `stage_${nextStage.stage}`,
              stageNumber: nextStage.stage,
              totalStages: pipeline.stages.length,
              name: nextStage.name,
              team: nextStage.team,
              leader: nextStage.leader,
              startedAt: new Date().toISOString(),
              elapsedMs: 0,
              round: 1,
              maxRounds: 3,
            }
            hb.status = 'working'
          }
        } else {
          // Last stage done
          hb.status = 'completed'
          hb.currentStage = null
        }
        hb.updatedAt = new Date().toISOString()
        await saveHeartbeat(hb)
      } catch {}

      // Update mission context with this stage's output
      missionContext += `${result.artifactId ? `ARTIFACT ${result.artifactId} HANDOFF READY\n` : ""}STAGE ${stage.stage} (${stage.team}/${stage.leader}) OUTPUT:\n${result.output.slice(0, 3000)}\n\nFINAL SCORE: ${result.finalScore}/100\nVERDICT: ${result.finalVerification.verdict}\n\n---\n\n`
      if (result.artifactId && stage.stage < pipeline.stages.length && result.artifactVerified) {
        const nextStage = pipeline.stages[stage.stage]
        if (nextStage) {
          try {
            await handoffArtifact(result.artifactId, nextStage.leader)
          } catch (handoffError: any) {
            await logApprovalEvent({
              missionId, stageId: `stage_${stage.stage}`, round: result.rounds,
              agentRole: 'artifact_ledger', agentId: 'artifact_ledger',
              action: 'handoff_failed', feedback: String(handoffError?.message ?? handoffError).slice(0, 500),
            })
            return { missionId, pipelineType: pipeline.type, success: false, stages, error: `Artifact handoff failed after Stage ${stage.stage}: ${String(handoffError?.message ?? handoffError).slice(0, 300)}` }
          }
        }
      }
      previousTeamOutput = result.output
      previousArtifactId = result.artifactId

      // If stage is the CEO (final), capture the report
      if (stage.team === 'ceo') {
        // UPGRADE #147 (Rec B fix) — Compute outcome CORRECTLY.
        // Before: `stages.every(s => s.artifactVerified || s.team === 'ceo') ? 'success' : 'partial'`
        //   This could NEVER return 'failed' — even if every stage failed verification,
        //   the result was 'partial'. That hid critical failures from the owner.
        // After: properly distinguish success / partial / failed based on stage scores.
        //
        // Rules:
        //   - 'failed'   = ANY stage has finalScore < 50 OR was escalated without approval
        //   - 'success'  = ALL non-CEO stages have artifactVerified === true AND score >= 70
        //   - 'partial'  = everything in between (some verified, some not, but none catastrophically failed)
        const nonCeoStages = stages.filter((s) => s.team !== 'ceo')
        const failedStages = nonCeoStages.filter((s) => s.finalScore < 50 || !s.artifactVerified && s.rounds >= 3)
        const allVerified = nonCeoStages.every((s) => s.artifactVerified)
        const allHighScore = nonCeoStages.every((s) => s.finalScore >= 70)
        const outcome: 'success' | 'partial' | 'failed' =
          failedStages.length > 0 ? 'failed'
          : (allVerified && allHighScore) ? 'success'
          : 'partial'

        // UPGRADE #147 (Rec B fix) — Build the CeoReport with the corrected outcome.
        const ceoReport: import('./ceo-presenter').CeoReport = {
          missionId,
          missionTitle: opts.missionTitle ?? missionId,
          objective,
          outcome,
          revenueImpact: 'See full report',
          keyDeliverables: stages.filter((s) => s.artifactValue && s.team !== 'ceo').map((s) => `Stage ${s.stage} (${s.team}): ${s.artifactValue}`),
          risksNotes: failedStages.length > 0
            ? [`${failedStages.length} stage(s) failed verification: ${failedStages.map((s) => `Stage ${s.stage} (${s.team}, score ${s.finalScore})`).join('; ')}`]
            : [],
          nextSteps: outcome === 'failed'
            ? ['Investigate failed stages in the audit trail', 'Decide whether to retry or abandon', 'Schedule a follow-up mission with adjusted strategy']
            : ['Review CEO report', 'Approve mission via dashboard if not yet approved', 'Schedule follow-up mission'],
          fullReport: result.output,
          generatedAt: new Date().toISOString(),
        }

        // UPGRADE #147 (Rec B fix) — Route through the CANONICAL ceo-presenter
        // side-effect functions (persist + Telegram + email) instead of inline
        // notifyTelegram. This ensures the report is delivered through every
        // channel the CEO presenter was designed to use, and is reusable by
        // other callers (e.g. resume flow, manual re-report).
        try {
          const { ceoPersistReport, ceoSendTelegram, ceoSendEmail } = await import('./ceo-presenter')
          await Promise.allSettled([
            ceoPersistReport(ceoReport),
            ceoSendTelegram(ceoReport),
            ceoSendEmail(ceoReport),
          ])
        } catch {}

        // UPGRADE #147 — Use the specific mission-complete notification (not generic)
        try {
          const { notifyMissionComplete } = await import('./mission-notifier')
          await notifyMissionComplete(missionId, opts.missionTitle ?? missionId, ceoReport.fullReport)
        } catch {}

        // UPGRADE #147 — Mark mission completed in the audit trail
        try {
          await logApprovalEvent({
            missionId,
            stageId: 'final',
            round: 1,
            agentRole: 'ceo',
            agentId: 'ceo',
            action: 'completed',
            feedback: `Mission completed with outcome: ${outcome}. ${failedStages.length} failed stage(s).`,
          })
        } catch {}

        return {
          missionId,
          pipelineType: pipeline.type,
          success: outcome !== 'failed',
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
      // UPGRADE #147 — use specific notification function (not generic)
      await notifyMissionFailed(missionId, `Stage ${stage.stage} (${stage.team}) crashed: ${stageErr?.message?.slice(0, 200) ?? 'unknown'}`)

      // UPGRADE #144 — Update heartbeat to failed
      try {
        const hb = await buildHeartbeatFromAuditLog({
          missionId,
          missionTitle: opts.missionTitle ?? missionId,
          pipelineType: pipeline.type,
          totalStages: pipeline.stages.length,
          objective,
          requiresOwnerApproval: !!pipeline.requiresOwnerApproval,
        })
        hb.status = 'failed'
        hb.lastError = `Stage ${stage.stage} (${stage.team}) crashed: ${stageErr?.message?.slice(0, 200) ?? 'unknown'}`
        hb.updatedAt = new Date().toISOString()
        await saveHeartbeat(hb)
      } catch {}

      return {
        missionId,
        pipelineType: pipeline.type,
        success: false,
        stages,
        error: `Stage ${stage.stage} (${stage.team}) crashed: ${stageErr?.message ?? 'unknown'}`,
      }
    }
  }

  // ── UPGRADE #146 (Critical #1 fix) — Removed unreachable post-loop approval check.
  // The CEO stage early-returns from inside the loop above, so this code was dead.
  // The approval gate is now checked BEFORE the CEO stage runs (see inside the loop).

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

/**
 * UPGRADE #147 (Rec A — Resume Trigger) — Resume a paused mission after owner approval.
 *
 * Before: When the owner clicked "Approve" in the dashboard or sent /approve_XXXXXXXX
 *   via Telegram, the approval was recorded in the audit log, but NOTHING actually
 *   resumed the mission. The CEO stage never ran. High-stakes missions got stuck
 *   in 'paused_owner' state forever.
 *
 * After: This function rebuilds the mission context from the audit trail (so we
 *   don't lose the prior stages' outputs) and re-invokes runMissionPipeline with
 *   `skipOwnerApproval: true` to run only the remaining stages (typically just
 *   the CEO stage).
 *
 * Called by /api/missions/[id]/approve immediately after marking the mission
 * approved. Runs in the background (fire-and-forget) so the API response is
 * immediate; the dashboard polls /api/missions/[id]/heartbeat for live progress.
 */
export async function resumeMissionPipeline(missionId: string): Promise<PipelineRunResult> {
  // Load the heartbeat to recover pipelineType + objective
  const { loadHeartbeat } = await import('./mission-heartbeat')
  const hb = await loadHeartbeat(missionId)
  if (!hb) {
    return {
      missionId,
      pipelineType: 'unknown',
      success: false,
      stages: [],
      error: 'Cannot resume — no heartbeat found for mission. The mission may have been created before UPGRADE #147.',
    }
  }

  // Re-invoke the pipeline with skipOwnerApproval=true
  // (the audit log already has the 'owner_approved' entry, so the gate will pass)
  return runMissionPipeline({
    missionId,
    pipelineType: hb.pipelineType,
    objective: hb.objective,
    missionTitle: hb.missionTitle,
    skipOwnerApproval: true,  // owner already approved — that's why we're resuming
  })
}

