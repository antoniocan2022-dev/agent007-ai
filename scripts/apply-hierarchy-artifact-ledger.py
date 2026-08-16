from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def patch_schema() -> None:
    p = ROOT / 'prisma/schema.prisma'
    text = p.read_text()
    if 'model ArtifactLedger {' in text:
        return
    text += '''\n\nmodel ArtifactLedger {\n  id                String    @id @default(cuid())\n  artifactId        String    @unique\n  missionId         String?\n  ventureId         String?\n  parentArtifactId  String?\n  stageId           String?\n  artifactType      String\n  name              String\n  version           Int       @default(1)\n  status            String    @default("submitted")\n  producerAgentId   String\n  consumerAgentId   String?\n  sourceRef         String?\n  artifactValue     String?\n  contentHash       String\n  verificationScore Float?\n  verifiedBy        String?\n  verifiedAt        DateTime?\n  metadata          String?\n  createdAt         DateTime  @default(now())\n  updatedAt         DateTime  @updatedAt\n\n  @@index([missionId])\n  @@index([ventureId])\n  @@index([parentArtifactId])\n  @@index([producerAgentId])\n  @@index([consumerAgentId])\n  @@index([status])\n}\n'''
    p.write_text(text)


def patch_db() -> None:
    p = ROOT / 'src/lib/db.ts'
    text = p.read_text()
    if 'CREATE TABLE IF NOT EXISTS "ArtifactLedger"' in text:
        return
    start = text.find('const statements = [')
    if start < 0:
        raise RuntimeError('db.ts: statements array not found')
    close = text.find('\n    ]', start)
    if close < 0:
        raise RuntimeError('db.ts: statements array closing bracket not found')
    ddl = '''      `CREATE TABLE IF NOT EXISTS "ArtifactLedger" (id TEXT PRIMARY KEY, "artifactId" TEXT UNIQUE NOT NULL, "missionId" TEXT, "ventureId" TEXT, "parentArtifactId" TEXT, "stageId" TEXT, "artifactType" TEXT NOT NULL, name TEXT NOT NULL, version INTEGER DEFAULT 1, status TEXT DEFAULT 'submitted', "producerAgentId" TEXT NOT NULL, "consumerAgentId" TEXT, "sourceRef" TEXT, "artifactValue" TEXT, "contentHash" TEXT NOT NULL, "verificationScore" DOUBLE PRECISION, "verifiedBy" TEXT, "verifiedAt" TIMESTAMP(3), metadata TEXT, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP)`,\n      `CREATE INDEX IF NOT EXISTS "ArtifactLedger_missionId_idx" ON "ArtifactLedger" ("missionId")`,\n      `CREATE INDEX IF NOT EXISTS "ArtifactLedger_ventureId_idx" ON "ArtifactLedger" ("ventureId")`,\n      `CREATE INDEX IF NOT EXISTS "ArtifactLedger_parentArtifactId_idx" ON "ArtifactLedger" ("parentArtifactId")`,\n      `CREATE INDEX IF NOT EXISTS "ArtifactLedger_producerAgentId_idx" ON "ArtifactLedger" ("producerAgentId")`,\n      `CREATE INDEX IF NOT EXISTS "ArtifactLedger_consumerAgentId_idx" ON "ArtifactLedger" ("consumerAgentId")`,\n      `CREATE INDEX IF NOT EXISTS "ArtifactLedger_status_idx" ON "ArtifactLedger" (status)`,\n'''
    text = text[:close] + '\n' + ddl + text[close:]
    text = text.replace("const SCHEMA_VERSION = 'v7-raw-sql-init-all-33-tables'", "const SCHEMA_VERSION = 'v8-raw-sql-init-artifact-ledger'")
    p.write_text(text)


def ensure_import(text: str, required_symbol: str, import_text: str, label: str) -> str:
    if import_text in text or (required_symbol in text and import_text.split('from ')[0].strip() in text):
        return text
    lines = text.splitlines()
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith('import '):
            insert_at = i + 1
        elif insert_at and line.strip() == '':
            break
    if insert_at == 0:
        raise RuntimeError(f'{label}: no import block found')
    lines.insert(insert_at, import_text)
    updated = '\n'.join(lines) + ('\n' if text.endswith('\n') else '')
    if import_text not in updated:
        raise RuntimeError(f'{label}: import insertion failed')
    return updated


def patch_governance() -> None:
    p = ROOT / 'src/lib/subagent-governance.ts'
    text = p.read_text()
    text = ensure_import(text, 'HIERARCHY_PARENT', "import { HIERARCHY_PARENT } from './hierarchy-control'", 'governance')
    mapping = {
        'aurora': 'vid', 'vertex': 'vid', 'quantum': 'vid', 'scout': 'vid',
        'hunt': 'scout', 'forge': 'vid', 'quill': 'aurora', 'prism': 'aurora',
        'pulse': 'vid', 'echo': 'vid', 'legal': 'cybersecurity_r', 'banker': 'vid',
        'trader': 'vid', 'cybersecurity_a': 'cybersecurity_r', 'cybersecurity_r': 'vid',
        'developer': 'forge', 'qa_monitor': 'vid', 'external_uptime_monitor': 'vid',
    }
    for agent, parent in mapping.items():
        pattern = rf"({re.escape(agent)}: \{{.*?reportsTo:\s*)'[^']+'"
        text2, n = re.subn(pattern, rf"\1HIERARCHY_PARENT.{parent}", text, count=1)
        if n == 1:
            text = text2
        elif f"{agent}: {{" not in text:
            raise RuntimeError(f'governance profile missing: {agent}')
    text = re.sub(r"(vid: \{.*?reportsTo:\s*)HIERARCHY_PARENT\.[A-Za-z0-9_]+", r"\1'ceo'", text, count=1)
    p.write_text(text)


def patch_subagents() -> None:
    p = ROOT / 'src/lib/subagents.ts'
    text = p.read_text()
    text = ensure_import(text, 'assertDelegationAllowed', "import { assertDelegationAllowed } from './hierarchy-control'\nimport { registerArtifact, handoffArtifact } from './artifact-ledger'", 'subagents')
    text = text.replace('  recursionDepth?: number\n}', '  recursionDepth?: number\n  parentAgentId?: string\n  missionId?: string\n  ventureId?: string\n  parentArtifactId?: string\n}', 1)
    guard = '''  const parentAgentId = opts.parentAgentId ?? 'ceo'\n  try {\n    assertDelegationAllowed(parentAgentId, sub.id, true)\n  } catch (hierarchyError: any) {\n    const err = hierarchyError?.message ?? 'Delegation blocked by hierarchy policy.'\n    await opts.emit('subagent_complete', { dispatchId: opts.dispatchId, answer: `⚠️ ${err}` })\n    return { answer: `⚠️ ${err}`, steps: [] }\n  }\n\n'''
    anchor = '  // UPGRADE #98 — TOOL RESTRICTION: Use the subagent\'s specialized allowedTools'
    if guard not in text:
        if anchor not in text:
            raise RuntimeError('subagents.ts: hierarchy insertion anchor missing')
        text = text.replace(anchor, guard + anchor, 1)
    if 'artifactId?: string' not in text.split('export interface RunSubagentResult {', 1)[1].split('}', 1)[0]:
        text = text.replace('export interface RunSubagentResult {\n  answer: string\n', 'export interface RunSubagentResult {\n  answer: string\n  artifactId?: string\n', 1)
    old_call = '''          parentConversationId: opts.parentConversationId,\n          recursionDepth: currentDepth + 1,\n        })'''
    new_call = '''          parentConversationId: opts.parentConversationId,\n          parentAgentId: sub.id,\n          missionId: opts.missionId,\n          ventureId: opts.ventureId,\n          parentArtifactId: opts.parentArtifactId,\n          recursionDepth: currentDepth + 1,\n        })'''
    if old_call in text:
        text = text.replace(old_call, new_call, 1)
    elif 'parentAgentId: sub.id' not in text:
        raise RuntimeError('subagents.ts: recursive runSubagent call anchor missing')
    handoff = '''        if (specialistResult.artifactId) {\n          await handoffArtifact(specialistResult.artifactId, sub.id).catch(() => {})\n        }\n'''
    target = '        // Feed the specialist\'s result back to the leader\n'
    if handoff not in text:
        if target not in text:
            raise RuntimeError('subagents.ts: specialist handoff anchor missing')
        text = text.replace(target, handoff + target, 1)
    return_marker = '  return { answer: finalAnswer, steps }'
    if return_marker in text and "artifactType: 'subagent_result'" not in text:
        replacement = '''  let artifactId: string | undefined\n  try {\n    const artifact = await registerArtifact({\n      missionId: opts.missionId,\n      ventureId: opts.ventureId,\n      parentArtifactId: opts.parentArtifactId,\n      stageId: opts.dispatchId,\n      artifactType: 'subagent_result',\n      name: `${sub.name} result`,\n      producerAgentId: sub.id,\n      sourceRef: `dispatch:${opts.dispatchId}`,\n      content: finalAnswer,\n      artifactValue: finalAnswer.slice(0, 4000),\n      status: 'submitted',\n    })\n    artifactId = artifact.artifactId\n  } catch (artifactError: any) {\n    console.warn('[artifact-ledger] subagent result registration failed:', artifactError?.message)\n  }\n\n  return { answer: finalAnswer, steps, artifactId }'''
        text = text.replace(return_marker, replacement, 1)
    if 'assertDelegationAllowed' not in text or 'registerArtifact' not in text or 'handoffArtifact' not in text:
        raise RuntimeError('subagents.ts: required architecture symbols were not integrated')
    p.write_text(text)


def patch_orchestrator() -> None:
    p = ROOT / 'src/lib/orchestrator.ts'
    text = p.read_text()
    text = ensure_import(text, 'handoffArtifact', "import { handoffArtifact } from './artifact-ledger'", 'orchestrator')
    text = re.sub(r"(runSubagent\(\{\s*\n\s*subagentId:\s*sub\.id,\s*task:\s*d\.task,\s*dispatchId,\s*\n\s*attachments,\s*language,\s*emit,\s*parentConversationId:\s*conversationId,)(\s*\n\s*\})", r"\1\n              parentAgentId: 'ceo',\n              \2", text, count=1)
    text = re.sub(r"(runSubagent\(\{\s*\n\s*subagentId:\s*sub\.id,\s*\n\s*task:\s*enhancedTask,)(\s*\n\s*attachments,)\s*(language,\s*\n\s*parentConversationId:\s*conversationId,)", r"\1\n          parentAgentId: 'ceo',\n          \2\n          \3", text, count=1)
    single_anchor = '        subAnswer = result.answer\n        // UPGRADE #169 C3:'
    if "handoffArtifact(result.artifactId, 'ceo')" not in text:
        if single_anchor not in text:
            raise RuntimeError('orchestrator: CEO handoff anchor missing')
        text = text.replace(single_anchor, "        subAnswer = result.answer\n        if (result.artifactId) await handoffArtifact(result.artifactId, 'ceo').catch(() => {})\n        // UPGRADE #169 C3:", 1)
    # Canonicalize all trailing whitespace so git diff --check is deterministic.
    text = '\n'.join(line.rstrip() for line in text.splitlines()) + '\n'
    p.write_text(text)


def patch_mission_pipeline() -> None:
    p = ROOT / 'src/lib/mission-pipeline.ts'
    text = p.read_text()
    text = ensure_import(text, 'registerArtifact', "import { registerArtifact, verifyArtifact, handoffArtifact } from './artifact-ledger'\nimport { getParentId } from './hierarchy-control'", 'mission-pipeline')
    text = text.replace('  previousTeamOutput?: string\n}): Promise<{', '  previousTeamOutput?: string\n  previousArtifactId?: string\n}): Promise<{', 1)
    text = text.replace('  artifactVerified: boolean\n}> {', '  artifactVerified: boolean\n  artifactId?: string\n}> {', 1)
    old = '''        parentConversationId: `mission_${missionId}`,\n        dispatchId: `pipeline_${missionId}_stage${stage.stage}_round${round}`,\n      })'''
    if old in text:
        text = text.replace(old, '''        parentConversationId: `mission_${missionId}`,\n        parentAgentId: getParentId(stage.leader) ?? 'vid',\n        missionId,\n        ventureId: undefined,\n        parentArtifactId: opts.previousArtifactId,\n        dispatchId: `pipeline_${missionId}_stage${stage.stage}_round${round}`,\n      })''', 1)
    ceo_return = '''      return {\n        output: teamOutput,\n        rounds: round,\n        finalScore: 100,'''
    if 'let ceoArtifactId: string | undefined' not in text:
        ceo_repl = '''      let ceoArtifactId: string | undefined\n      try {\n        const artifact = await registerArtifact({\n          missionId, stageId: `stage_${stage.stage}`, artifactType: 'executive_report',\n          name: stage.name, producerAgentId: 'ceo', sourceRef: `mission:${missionId}:stage:${stage.stage}`,\n          content: teamOutput, artifactValue: teamOutput.slice(0, 4000), status: 'verified',\n          verificationScore: 100, verifiedBy: 'ceo', verifiedAt: new Date(),\n        })\n        ceoArtifactId = artifact.artifactId\n      } catch {}\n\n      return {\n        output: teamOutput,\n        rounds: round,\n        finalScore: 100,'''
        if ceo_return not in text:
            raise RuntimeError('mission-pipeline: CEO artifact anchor missing')
        text = text.replace(ceo_return, ceo_repl, 1)
        text = text.replace('        artifactVerified: true,\n      }\n    }', '        artifactVerified: true,\n        artifactId: ceoArtifactId,\n      }\n    }', 1)
    if "artifactType: stage.artifactType" not in text:
        old_extract = '''  const artifactValue = extractArtifact(teamOutput, stage.artifactType)\n  const artifactVerified = artifactValue !== null && lastVerification?.approved === true\n\n  // UPGRADE #146'''
        new_extract = '''  const artifactValue = extractArtifact(teamOutput, stage.artifactType)\n  const artifactVerified = artifactValue !== null && lastVerification?.approved === true\n  let artifactId: string | undefined\n  try {\n    const artifact = await registerArtifact({\n      missionId, stageId: `stage_${stage.stage}`, artifactType: stage.artifactType,\n      name: stage.name, producerAgentId: stage.leader, sourceRef: `mission:${missionId}:stage:${stage.stage}:round:${lastRound}`,\n      artifactValue, content: teamOutput, status: lastVerification?.approved ? 'verified' : 'rejected',\n      verificationScore: lastVerification?.score ?? 0, verifiedBy: 'super_agent',\n      verifiedAt: lastVerification ? new Date() : undefined, metadata: { round: lastRound },\n    })\n    artifactId = artifact.artifactId\n    if (artifactVerified) await verifyArtifact(artifactId, lastVerification?.score ?? 0, 'super_agent', 'verified')\n  } catch {}\n\n  // UPGRADE #146'''
        if old_extract not in text:
            raise RuntimeError('mission-pipeline: artifact extraction anchor missing')
        text = text.replace(old_extract, new_extract, 1)
        text = text.replace('    artifactVerified,\n  }\n}\n\n/**\n * Best-effort extract', '    artifactVerified,\n    artifactId,\n  }\n}\n\n/**\n * Best-effort extract', 1)
    text = text.replace('  let previousTeamOutput: string | undefined\n', '  let previousTeamOutput: string | undefined\n  let previousArtifactId: string | undefined\n', 1)
    text = text.replace('        previousTeamOutput,\n      })', '        previousTeamOutput,\n        previousArtifactId,\n      })', 1)
    if 'previousArtifactId = result.artifactId' not in text:
        text = text.replace('      previousTeamOutput = result.output\n', '''      if (result.artifactId && stage.stage < pipeline.stages.length && result.artifactVerified) {\n        const nextStage = pipeline.stages[stage.stage]\n        if (nextStage) await handoffArtifact(result.artifactId, nextStage.leader).catch(() => {})\n      }\n      previousTeamOutput = result.output\n      previousArtifactId = result.artifactId\n''', 1)
    if 'ARTIFACT ${result.artifactId} HANDOFF READY' not in text:
        text = text.replace('      missionContext += `STAGE ${stage.stage} (${stage.team}/${stage.leader}) OUTPUT:', '      missionContext += `${result.artifactId ? `ARTIFACT ${result.artifactId} HANDOFF READY\\n` : ""}STAGE ${stage.stage} (${stage.team}/${stage.leader}) OUTPUT:', 1)
    p.write_text(text)


def main() -> None:
    patch_schema(); patch_db(); patch_governance(); patch_subagents(); patch_orchestrator(); patch_mission_pipeline()
    required = ['src/lib/hierarchy-control.ts','src/lib/artifact-ledger.ts','src/lib/subagent-governance.ts','src/lib/subagents.ts','src/lib/orchestrator.ts','src/lib/mission-pipeline.ts','prisma/schema.prisma','src/lib/db.ts']
    for rel in required:
        if not (ROOT / rel).exists(): raise RuntimeError(f'Missing required file after repair: {rel}')
    print('Architecture transformation complete: hierarchy + artifact ledger')

if __name__ == '__main__': main()