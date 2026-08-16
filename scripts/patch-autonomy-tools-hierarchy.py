from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

tools = ROOT / 'src/lib/tools.ts'
text = tools.read_text()
if '  parentAgentId?: string' not in text.split('export interface ToolContext {', 1)[1].split('}', 1)[0]:
    text = text.replace('  conversationId?: string\n}', '  conversationId?: string\n  /** Immediate governed parent for delegated subagent work. */\n  parentAgentId?: string\n}', 1)
tools.write_text(text)

autonomy = ROOT / 'src/lib/autonomy-tools.ts'
text = autonomy.read_text()
old = "emit: ctx?.emit ?? (async () => {}), parentConversationId: ctx?.conversationId ?? 'parallel',"
new = "emit: ctx?.emit ?? (async () => {}), parentConversationId: ctx?.conversationId ?? 'parallel', parentAgentId: ctx?.parentAgentId ?? 'vid',"
if old not in text:
    if "parentAgentId: ctx?.parentAgentId ?? 'vid'" not in text:
        raise RuntimeError('autonomy-tools.ts: parallel runSubagent anchor missing')
else:
    text = text.replace(old, new, 1)
autonomy.write_text(text)
print('Parallel autonomy tool now propagates governed parentAgentId (default: VID).')
