from pathlib import Path

path = Path('prisma/schema.prisma')
text = path.read_text()

old_transaction = '''model Transaction {\n  id            String   @id @default(cuid())\n  userId        String\n  provider      String\n  providerTxId  String\n  amount        Float\n  currency      String   @default("USD")\n  status        String   @default("succeeded")\n  customerEmail String?\n  customerName  String?\n  productName   String?\n  description   String?\n  rawPayload    String\n  createdAt     DateTime @default(now())\n\n  @@unique([provider, providerTxId])\n  @@index([userId])\n}\n'''

new_transaction = '''model Transaction {\n  id            String    @id @default(cuid())\n  userId        String\n  provider      String\n  providerTxId  String\n  amount        Float\n  currency      String    @default("USD")\n  status        String    @default("succeeded")\n  customerEmail String?\n  customerName  String?\n  productName   String?\n  description   String?\n  rawPayload    String\n  customerId    String?\n  Customer      Customer? @relation(fields: [customerId], references: [id], onDelete: SetNull, onUpdate: Cascade)\n  createdAt     DateTime  @default(now())\n\n  @@unique([provider, providerTxId])\n  @@index([userId])\n  @@index([customerId])\n}\n'''

if old_transaction not in text:
    raise SystemExit('Expected Transaction model shape not found; refusing to patch.')
if 'customerId    String?' in old_transaction:
    raise SystemExit('Transaction customerId already present; refusing to duplicate it.')
text = text.replace(old_transaction, new_transaction, 1)

customer_marker = '''model Customer {\n  id        String   @id @default(cuid())\n  userId    String\n'''
if customer_marker not in text:
    raise SystemExit('Customer model marker not found; refusing to patch.')
customer_block = '''model Customer {\n  id          String        @id @default(cuid())\n  userId      String\n'''
text = text.replace(customer_marker, customer_block, 1)
customer_tail = '''  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt @default(now())\n\n  @@index([status])\n  @@index([userId])\n}\n'''
replacement_tail = '''  createdAt   DateTime      @default(now())\n  updatedAt   DateTime      @updatedAt @default(now())\n  Transaction Transaction[]\n\n  @@index([status])\n  @@index([userId])\n}\n'''
if customer_tail not in text:
    raise SystemExit('Customer tail not found; refusing to patch.')
text = text.replace(customer_tail, replacement_tail, 1)
path.write_text(text)
print('Patched Prisma Transaction.customerId relation contract.')
