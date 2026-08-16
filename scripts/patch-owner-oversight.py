from pathlib import Path

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

route = ROOT / 'src/app/api/team/[leaderId]/route.ts'
text = route.read_text()
text = add_import(text, "import { OWNER_AUTHORITY_ID } from '@/lib/hierarchy-control'")
text = text.replace(
    "parentConversationId: 'leader-chat',\n",
    "parentConversationId: 'leader-chat',\n      parentAgentId: OWNER_AUTHORITY_ID,\n      delegationAuthority: 'owner',\n",
    1,
)
if "delegationAuthority: 'owner'" not in text:
    raise RuntimeError('team route owner oversight propagation was not inserted')
route.write_text(text)

mission = ROOT / 'src/app/api/mission-active/[missionId]/route.ts'
text = mission.read_text()
text = text.replace(
    "appendLeaderMessageDB(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)",
    "appendLeaderMessageDB(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)",
    1,
)
text = text.replace(
    "appendLeaderMessage(missionId, leaderInfo.leaderId, leaderInfo.leaderName, leaderResponse)",
    "appendLeaderMessage(missionId, leaderInfo.leaderId, 'LEADER', leaderResponse)",
    1,
)
route.write_text(text)

print('Owner oversight authority propagated idempotently; mission leader response roles normalized.')
