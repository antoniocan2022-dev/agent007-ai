from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src/lib/max-autonomy-engine.ts'
text = path.read_text()
needle = "parentConversationId: 'mission',"
count = text.count(needle)
if count == 0:
    raise RuntimeError('max-autonomy-engine.ts: expected mission dispatch parent anchor not found')
if count > 3:
    raise RuntimeError(f'max-autonomy-engine.ts: ambiguous mission parent anchors: {count}')
updated = text.replace(needle, "parentConversationId: 'mission',\n        parentAgentId: 'vid',", count)
path.write_text(updated)
print(f'Governed {count} autonomous mission dispatches under VID.')
