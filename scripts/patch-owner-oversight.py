from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def add_import(text: str, import_text: str) -> str:
    if import_text in text:
        return text
    lines = text.splitlines()
    insert = 0
    for i, line in enumerate(lines):
        if line.startswith('import '):
            insert = i + 1
        elif insert and not line.strip():
            break
    if insert == 0:
        raise RuntimeError(f'No import block for {import_text}')
    lines.insert(insert, import_text)
    return '\n'.join(lines) + ('\n' if text.endswith('\n') else '')


def canonicalize_subagent_imports(text: str) -> str:
    lines = [
        line for line in text.splitlines()
        if line.strip() not in {
            "import { assertDelegationAllowed } from './hierarchy-control'",
            "import { registerArtifact, handoffArtifact } from './artifact-ledger'",
        }
    ]
    cleaned = '\n'.join(lines) + ('\n' if text.endswith('\n') else '')
    return add_import(
        cleaned,
        "import { assertDelegationAllowed, type DelegationAuthority } from './hierarchy-control'\nimport { registerArtifact, handoffArtifact } from './artifact-ledger'",
    )


subagents = ROOT / 'src/lib/subagents.ts'
text = canonicalize_subagent_imports(subagents.read_text())
if 'delegationAuthority?: DelegationAuthority' not in text:
    text = text.replace('  parentAgentId?: string\n', '  parentAgentId?: string\n  delegationAuthority?: DelegationAuthority\n', 1)
text = text.replace(
    'assertDelegationAllowed(parentAgentId, sub.id, true)',
    "assertDelegationAllowed(parentAgentId, sub.id, true, opts.delegationAuthority ?? 'agent')",
    1,
)
if "opts.delegationAuthority ?? 'agent'" not in text:
    raise RuntimeError('runSubagent does not consume delegationAuthority')
subagents.write_text(text)

tools = ROOT / 'src/lib/tools.ts'
text = tools.read_text()
if 'parentAgentId?: string' not in text.split('export interface ToolContext {', 1)[1].split('}', 1)[0]:
    text = text.replace('  conversationId?: string\n', '  conversationId?: string\n  /** Immediate governed parent for delegated subagent work. */\n  parentAgentId?: string\n', 1)
tools.write_text(text)

team_route = ROOT / 'src/app/api/team/[leaderId]/route.ts'
team_text = team_route.read_text()
team_text = add_import(team_text, "import { OWNER_AUTHORITY_ID } from '@/lib/hierarchy-control'")
# Canonicalize the owner-controlled dispatch metadata before inserting it exactly once.
team_text = re.sub(r"\n\s*parentAgentId:\s*OWNER_AUTHORITY_ID,", "", team_text)
team_text = re.sub(r"\n\s*delegationAuthority:\s*'owner',", "", team_text)
team_text = re.sub(
    r"parentConversationId\s*:\s*'leader-chat',\s*",
    "parentConversationId: 'leader-chat',\n      parentAgentId: OWNER_AUTHORITY_ID,\n      delegationAuthority: 'owner',\n",
    team_text,
    count=1,
)
if not all(token in team_text for token in ['OWNER_AUTHORITY_ID', 'parentAgentId: OWNER_AUTHORITY_ID', "delegationAuthority: 'owner'"]):
    raise RuntimeError('team route owner oversight propagation was not inserted completely')
team_route.write_text(team_text)

mission_route = ROOT / 'src/app/api/mission-active/[missionId]/route.ts'
mission_text = mission_route.read_text()
mission_text = mission_text.replace(
    "appendLeaderMessageDB(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)",
    "appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)",
)
mission_text = mission_text.replace(
    "appendLeaderMessage(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)",
    "appendLeaderMessage(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)",
)
if 'appendLeaderMessageDB(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)' in mission_text or 'appendLeaderMessage(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)' in mission_text:
    raise RuntimeError('mission leader response still uses an invalid role value')
mission_route.write_text(mission_text)

# Final postconditions must inspect the actual persisted files, catching accidental cross-file writes or duplicates.
final_team = team_route.read_text()
final_mission = mission_route.read_text()
assert 'OWNER_AUTHORITY_ID' in final_team
assert final_team.count('parentAgentId: OWNER_AUTHORITY_ID') == 1
assert final_team.count("delegationAuthority: 'owner'") == 1
assert 'getParentId' in final_mission
assert "parentAgentId: getParentId(sub.id) ?? 'vid'" in final_mission
assert "appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)" in final_mission
assert "appendLeaderMessage(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)" in final_mission

print('Owner oversight authority propagated idempotently; mission leader response roles normalized; cross-route and duplicate-field guards: PASS.')