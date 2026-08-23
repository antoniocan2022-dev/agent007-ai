from pathlib import Path
import re

path = Path('prisma/schema.prisma')
text = path.read_text()
match = re.search(r'model Transaction \{.*?\n\}', text, re.S)
if not match:
    raise SystemExit('Transaction model not found; refusing to patch.')
block = match.group(0)

if re.search(r'^  ventureId\s+String\?', block, re.M) is None:
    marker = '  rawPayload    String\n'
    if marker not in block:
        raise SystemExit('Transaction rawPayload marker not found.')
    block = block.replace(marker, marker + '  ventureId     String?\n', 1)
if re.search(r'^  customerId\s+String\?', block, re.M) is None:
    marker = '  rawPayload    String\n'
    if marker not in block:
        raise SystemExit('Transaction rawPayload marker not found.')
    if '  ventureId     String?\n' in block:
        block = block.replace('  ventureId     String?\n', '  ventureId     String?\n  customerId    String?\n', 1)
    else:
        block = block.replace(marker, marker + '  customerId    String?\n', 1)

if '@@index([ventureId])' not in block:
    block = block.replace('  @@index([userId])\n', '  @@index([userId])\n  @@index([ventureId])\n', 1)
if '@@index([customerId])' not in block:
    block = block.replace('  @@index([ventureId])\n', '  @@index([ventureId])\n  @@index([customerId])\n', 1)

text = text[:match.start()] + block + text[match.end():]
path.write_text(text)
print('Prisma Transaction schema synchronized with ventureId and customerId runtime contract.')
