import { PrismaClient } from '@prisma/client'

export interface TransactionCustomerSchemaVerification {
  column: { name: string; dataType: string; isNullable: boolean }
  foreignKey: { name: string; sourceColumn: string; targetTable: string; targetColumn: string; deleteRule: string; updateRule: string }
  index: { name: string; isUnique: boolean; columnNames: string[] }
}

export async function verifyTransactionCustomerSchema(prisma: PrismaClient): Promise<TransactionCustomerSchemaVerification> {
  const columns = await prisma.$queryRaw<Array<{
    column_name: string
    data_type: string
    is_nullable: 'YES' | 'NO'
  }>>`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Transaction'
      AND column_name = 'customerId'
  `

  if (columns.length !== 1) throw new Error('Transaction.customerId column is missing or duplicated in the public schema.')
  const column = columns[0]
  if (column.data_type !== 'text' || column.is_nullable !== 'YES') {
    throw new Error(`Transaction.customerId schema mismatch: expected nullable text, found ${column.data_type} ${column.is_nullable}.`)
  }

  const foreignKeys = await prisma.$queryRaw<Array<{
    constraint_name: string
    source_column: string
    target_table: string
    target_column: string
    delete_rule: string
    update_rule: string
  }>>`
    SELECT
      tc.constraint_name,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column,
      rc.delete_rule,
      rc.update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.constraint_schema = rc.constraint_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'Transaction'
      AND tc.constraint_name = 'Transaction_customerId_fkey'
      AND tc.constraint_type = 'FOREIGN KEY'
  `

  if (foreignKeys.length !== 1) throw new Error('Transaction_customerId_fkey is missing or duplicated.')
  const foreignKey = foreignKeys[0]
  const expectedForeignKey = {
    name: 'Transaction_customerId_fkey',
    sourceColumn: 'customerId',
    targetTable: 'Customer',
    targetColumn: 'id',
    deleteRule: 'SET NULL',
    updateRule: 'CASCADE',
  }
  if (
    foreignKey.constraint_name !== expectedForeignKey.name ||
    foreignKey.source_column !== expectedForeignKey.sourceColumn ||
    foreignKey.target_table !== expectedForeignKey.targetTable ||
    foreignKey.target_column !== expectedForeignKey.targetColumn ||
    foreignKey.delete_rule !== expectedForeignKey.deleteRule ||
    foreignKey.update_rule !== expectedForeignKey.updateRule
  ) {
    throw new Error(`Transaction.customerId foreign key definition mismatch: ${JSON.stringify(foreignKey)}.`)
  }

  const indexes = await prisma.$queryRaw<Array<{
    index_name: string
    is_unique: boolean
    column_names: string[]
  }>>`
    SELECT
      idx.relname AS index_name,
      i.indisunique AS is_unique,
      ARRAY_AGG(att.attname ORDER BY key_positions.position) AS column_names
    FROM pg_class table_ref
    JOIN pg_index i ON i.indrelid = table_ref.oid
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key_positions(attnum, position) ON true
    JOIN pg_attribute att
      ON att.attrelid = table_ref.oid
     AND att.attnum = key_positions.attnum
    WHERE table_ref.relkind IN ('r', 'p')
      AND table_ref.relname = 'Transaction'
      AND idx.relname = 'Transaction_customerId_idx'
      AND i.indnkeyatts = 1
    GROUP BY idx.relname, i.indisunique
  `

  if (indexes.length !== 1) throw new Error('Transaction_customerId_idx is missing, duplicated, or has the wrong key cardinality.')
  const index = indexes[0]
  if (index.is_unique || index.column_names.join(',') !== 'customerId') {
    throw new Error(`Transaction.customerId index definition mismatch: ${JSON.stringify(index)}.`)
  }

  return {
    column: {
      name: column.column_name,
      dataType: column.data_type,
      isNullable: column.is_nullable === 'YES',
    },
    foreignKey: {
      name: foreignKey.constraint_name,
      sourceColumn: foreignKey.source_column,
      targetTable: foreignKey.target_table,
      targetColumn: foreignKey.target_column,
      deleteRule: foreignKey.delete_rule,
      updateRule: foreignKey.update_rule,
    },
    index: {
      name: index.index_name,
      isUnique: index.is_unique,
      columnNames: index.column_names,
    },
  }
}
