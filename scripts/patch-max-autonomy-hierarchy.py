from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src/lib/max-autonomy-engine.ts'
text = path.read_text()
mission_needle = "parentConversationId: 'mission',"
offline_needle = "parentConversationId: 'offline',"
mission_count = text.count(mission_needle)
offline_count = text.count(offline_needle)
if mission_count != 3:
    raise RuntimeError(f'max-autonomy-engine.ts: expected 3 mission dispatch anchors, found {mission_count}')
if offline_count != 1:
    raise RuntimeError(f'max-autonomy-engine.ts: expected 1 offline dispatch anchor, found {offline_count}')
text = text.replace(mission_needle, "parentConversationId: 'mission',\n        parentAgentId: 'vid',")
text = text.replace(offline_needle, "parentConversationId: 'offline',\n          parentAgentId: 'vid',")
path.write_text(text)
print('Governed 3 mission and 1 offline autonomous dispatch paths under VID.')
