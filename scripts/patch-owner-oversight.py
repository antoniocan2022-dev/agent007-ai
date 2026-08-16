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

subagents = ROOT / 'src/lib/subagents.ts'
text = subagents.read_text()
text = add_import(text, "import { assertDelegationAllowed, type DelegationAuthority } from './hierarchy-control'\nimport { registerArtifact, handoffArtifact } from './artifact-ledger'")
if 'delegationAuthority?: DelegationAuthority' not in text:
    text = text.replace('  parentAgentId?: string\n', '  parentAgentId?: string\n  delegationAuthority?: DelegationAuthority\n', 1)
text = text.replace(
    'assertDelegationAllowed(parentAgentId, sub.id, true)',
    "assertDelegationAllowed(parentAgentId, sub.id, true, opts.delegationAuthority ?? 'agent')",
    1,
)
if 'opts.delegationAuthority ?? \'agent\'' not in text:
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

print('Owner oversight authority propagated through subagent runtime and team API.')
