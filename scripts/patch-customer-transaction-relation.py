from pathlib import Path
import re

path = Path('prisma/schema.prisma')
text = path.read_text()
match = re.search(r'model Customer \{.*?\n\}', text, re.S)
if not match:
    raise SystemExit('Customer model not found; refusing to patch.')
block = match.group(0)
if 'Transaction Transaction[]' in block:
    raise SystemExit('Customer Transaction relation already present; refusing to duplicate it.')
marker = re.search(r'  updatedAt\s+DateTime.*?\n\n  @@index', block, re.S)
if not marker:
    raise SystemExit('Customer updatedAt/index boundary not found; refusing to patch.')
replacement = marker.group(0).replace('\n\n  @@index', '\n  Transaction Transaction[]\n\n  @@index', 1)
block = block[:marker.start()] + replacement + block[marker.end():]
text = text[:match.start()] + block + text[match.end():]
path.write_text(text)
print('Completed Customer.Transaction[] Prisma relation.')
