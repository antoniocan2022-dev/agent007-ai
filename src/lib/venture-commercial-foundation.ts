import { db } from './db'
import { assertRealSucceededTransaction } from './transaction-evidence-integrity'

export const INITIAL_BUSINESS_UNITS = [
  { businessKey: 'revenue-recovery', name: 'AI Revenue Recovery', description: 'Recover and create measurable revenue for local businesses.' },
  { businessKey: 'operations-kit', name: 'Small Business Operations Kit', description: 'Productized AI-powered operations and workflow automation for small businesses.' },
  { businessKey: 'career-command', name: 'Career Command Center', description: 'B2C career intelligence, applications, interview preparation, and progression.' },
] as const

export type BusinessUnitKey = typeof INITIAL_BUSINESS_UNITS[number]['businessKey']
export type VentureStatus = 'PROPOSED' | 'VALIDATING' | 'BUILDING' | 'LAUNCHING' | 'ACTIVE' | 'SCALING' | 'PAUSED' | 'RETIRED' | 'REFERENCE'

export interface BusinessUnitRecord { id: string; ownerUserId: string; businessKey: BusinessUnitKey; name: string; description: string; status: 'ACTIVE' | 'PAUSED' | 'RETIRED'; createdAt: string; updatedAt: string }
export interface VentureRecord { id: string; ventureKey: string; businessUnitId: string | null; ownerUserId: string; name: string; type: string; description: string; targetMarket: string; pricingModel: string; status: VentureStatus; productionState: 'STRUCTURAL_ONLY' | 'VALIDATION' | 'PRODUCTION'; createdAt: string; updatedAt: string }
export interface VentureCommercialSnapshot { ventureId: string; customers: number; opportunities: number; transactions: number; campaigns: number; incomeEntries: number; subscriptions: number; invoices: number; grossTransactionRevenue: number; campaignRevenue: number; incomeRecorded: number; openInvoices: number; paidInvoices: number; activeSubscriptions: number }
export interface SubscriptionInput { ventureId: string; customerId: string; provider: string; providerSubscriptionId?: string | null; status?: string; plan: string; amount: number; currency?: string; interval?: string; currentPeriodStart?: string | null; currentPeriodEnd?: string | null; cancelAtPeriodEnd?: boolean; rawPayload?: string | null }
export interface InvoiceInput { ventureId: string; customerId: string; subscriptionId?: string | null; transactionId?: string | null; provider: string; providerInvoiceId?: string | null; status?: string; amount: number; currency?: string; dueAt?: string | null; paidAt?: string | null; rawPayload?: string | null }

const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const positiveAmount = (value: number, label: string) => { if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number.`); return Number(value.toFixed(2)) }
function isoOrNull(value: string | null | undefined, label: string): string | null { if (value == null || value === '') return null; const parsed = Date.parse(value); if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO-compatible timestamp.`); return new Date(parsed).toISOString() }
function businessUnitId(ownerUserId: string, businessKey: BusinessUnitKey): string { return `bu:${ownerUserId}:${businessKey}` }

export async function ensureInitialBusinessUnits(ownerUserId: string): Promise<BusinessUnitRecord[]> {
  const owner = clean(ownerUserId)
  if (!owner) throw new Error('ownerUserId is required.')
  if (!await db.user.findUnique({ where: { id: owner }, select: { id: true } })) throw new Error(`Owner user not found: ${owner}.`)
  const result: BusinessUnitRecord[] = []
  for (const unit of INITIAL_BUSINESS_UNITS) {
    const id = businessUnitId(owner, unit.businessKey)
    await db.$executeRaw`INSERT INTO "BusinessUnit" ("id","ownerUserId","businessKey","name","description") VALUES (${id},${owner},${unit.businessKey},${unit.name},${unit.description}) ON CONFLICT ("id") DO UPDATE SET "name"=EXCLUDED."name","description"=EXCLUDED."description","updatedAt"=CURRENT_TIMESTAMP`
    const rows = await db.$queryRaw<BusinessUnitRecord[]>`SELECT "id","ownerUserId","businessKey","name","description","status","createdAt","updatedAt" FROM "BusinessUnit" WHERE "id"=${id} LIMIT 1`
    if (!rows[0]) throw new Error(`Business unit was not persisted: ${unit.businessKey}.`)
    result.push(rows[0])
  }
  return result
}

export async function getBusinessUnitByKey(ownerUserId: string, businessKey: BusinessUnitKey): Promise<BusinessUnitRecord | null> {
  const id = businessUnitId(clean(ownerUserId), businessKey)
  const rows = await db.$queryRaw<BusinessUnitRecord[]>`SELECT "id","ownerUserId","businessKey","name","description","status","createdAt","updatedAt" FROM "BusinessUnit" WHERE "id"=${id} LIMIT 1`
  return rows[0] ?? null
}

export async function createOrGetVenture(input: Omit<VentureRecord,'id'|'createdAt'|'updatedAt'>): Promise<VentureRecord> {
  const ventureKey = clean(input.ventureKey).toLowerCase(); const ownerUserId = clean(input.ownerUserId); const name = clean(input.name)
  if (!ventureKey || !ownerUserId || !name) throw new Error('ventureKey, ownerUserId, and name are required.')
  if (!await db.user.findUnique({ where: { id: ownerUserId }, select: { id: true } })) throw new Error(`Owner user not found: ${ownerUserId}.`)
  if (input.businessUnitId) {
    const bu = await db.$queryRaw<Array<{ id: string; ownerUserId: string }>>`SELECT "id","ownerUserId" FROM "BusinessUnit" WHERE "id"=${input.businessUnitId} LIMIT 1`
    if (!bu[0]) throw new Error(`Business unit not found: ${input.businessUnitId}.`)
    if (bu[0].ownerUserId !== ownerUserId) throw new Error('Business unit owner does not match venture owner.')
  }
  const existing = await db.$queryRaw<VentureRecord[]>`SELECT "id","ventureKey","businessUnitId","ownerUserId","name","type","description","targetMarket","pricingModel","status","productionState","createdAt","updatedAt" FROM "Venture" WHERE "ventureKey"=${ventureKey} LIMIT 1`
  if (existing[0]) {
    const venture = existing[0]
    if (venture.ownerUserId !== ownerUserId) throw new Error(`Venture ${ventureKey} already belongs to another owner.`)
    if (input.businessUnitId && venture.businessUnitId && venture.businessUnitId !== input.businessUnitId) throw new Error(`Venture ${ventureKey} is already attached to a different business unit.`)
    if (input.businessUnitId && !venture.businessUnitId) {
      await db.$executeRaw`UPDATE "Venture" SET "businessUnitId"=${input.businessUnitId},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${venture.id} AND "ownerUserId"=${ownerUserId}`
      const attached = await db.$queryRaw<VentureRecord[]>`SELECT "id","ventureKey","businessUnitId","ownerUserId","name","type","description","targetMarket","pricingModel","status","productionState","createdAt","updatedAt" FROM "Venture" WHERE "id"=${venture.id} LIMIT 1`
      if (!attached[0]) throw new Error(`Venture ${ventureKey} could not be re-read after business-unit attachment.`)
      return attached[0]
    }
    return venture
  }
  try {
    await db.$executeRaw`INSERT INTO "Venture" ("id","ventureKey","businessUnitId","ownerUserId","name","type","description","targetMarket","pricingModel","status","productionState") VALUES (${ventureKey},${ventureKey},${input.businessUnitId},${ownerUserId},${name},${clean(input.type)},${clean(input.description)},${clean(input.targetMarket)},${clean(input.pricingModel)},${input.status},${input.productionState})`
  } catch (error) {
    const raced = await db.$queryRaw<VentureRecord[]>`SELECT "id","ventureKey","businessUnitId","ownerUserId","name","type","description","targetMarket","pricingModel","status","productionState","createdAt","updatedAt" FROM "Venture" WHERE "ventureKey"=${ventureKey} LIMIT 1`
    if (!raced[0]) throw error
    if (raced[0].ownerUserId !== ownerUserId) throw new Error(`Venture ${ventureKey} already belongs to another owner.`)
  }
  const rows = await db.$queryRaw<VentureRecord[]>`SELECT "id","ventureKey","businessUnitId","ownerUserId","name","type","description","targetMarket","pricingModel","status","productionState","createdAt","updatedAt" FROM "Venture" WHERE "ventureKey"=${ventureKey} LIMIT 1`
  if (!rows[0]) throw new Error(`Venture was not persisted: ${ventureKey}.`)
  return rows[0]
}

export async function getVenture(ventureKey: string): Promise<VentureRecord | null> {
  const key = clean(ventureKey).toLowerCase(); const rows = await db.$queryRaw<VentureRecord[]>`SELECT "id","ventureKey","businessUnitId","ownerUserId","name","type","description","targetMarket","pricingModel","status","productionState","createdAt","updatedAt" FROM "Venture" WHERE "ventureKey"=${key} LIMIT 1`; return rows[0] ?? null
}
export async function assertVentureOwner(ventureKey: string, ownerUserId: string): Promise<VentureRecord> { const venture=await getVenture(ventureKey); if(!venture) throw new Error(`Venture not found: ${ventureKey}.`); if(venture.ownerUserId!==ownerUserId) throw new Error(`Venture ${ventureKey} is not owned by the requested operator.`); return venture }
async function assertVentureForAttach(ventureId:string):Promise<VentureRecord>{const venture=await getVenture(ventureId);if(!venture)throw new Error(`Venture relational record not found: ${ventureId}.`);return venture}

export async function linkCustomerToVenture(customerId:string, ventureId:string):Promise<void>{await assertVentureForAttach(ventureId);const rows=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "Customer" WHERE "id"=${customerId} LIMIT 1`;if(!rows[0])throw new Error(`Customer not found: ${customerId}.`);if(rows[0].ventureId&&rows[0].ventureId!==ventureId)throw new Error(`Customer ${customerId} is already scoped to another venture.`);await db.$executeRaw`UPDATE "Customer" SET "ventureId"=${ventureId},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${customerId}`}
export async function linkOpportunityToVenture(opportunityId:string, ventureId:string):Promise<void>{await assertVentureForAttach(ventureId);const rows=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "Opportunity" WHERE "id"=${opportunityId} LIMIT 1`;if(!rows[0])throw new Error(`Opportunity not found: ${opportunityId}.`);if(rows[0].ventureId&&rows[0].ventureId!==ventureId)throw new Error(`Opportunity ${opportunityId} is already scoped to another venture.`);await db.$executeRaw`UPDATE "Opportunity" SET "ventureId"=${ventureId},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${opportunityId}`}
export async function linkTransactionToVenture(transactionId:string, ventureId:string):Promise<void>{await assertVentureForAttach(ventureId);const rows=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "Transaction" WHERE "id"=${transactionId} LIMIT 1`;if(!rows[0])throw new Error(`Transaction not found: ${transactionId}.`);if(rows[0].ventureId&&rows[0].ventureId!==ventureId)throw new Error(`Transaction ${transactionId} is already scoped to another venture.`);await db.$executeRaw`UPDATE "Transaction" SET "ventureId"=${ventureId} WHERE "id"=${transactionId}`}
export async function linkMarketingCampaignToVenture(campaignId:string, ventureId:string):Promise<void>{await assertVentureForAttach(ventureId);const rows=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "MarketingCampaign" WHERE "id"=${campaignId} LIMIT 1`;if(!rows[0])throw new Error(`Marketing campaign not found: ${campaignId}.`);if(rows[0].ventureId&&rows[0].ventureId!==ventureId)throw new Error(`Marketing campaign ${campaignId} is already scoped to another venture.`);await db.$executeRaw`UPDATE "MarketingCampaign" SET "ventureId"=${ventureId},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${campaignId}`}
export async function linkIncomeEntryToVenture(incomeEntryId:string, ventureId:string):Promise<void>{await assertVentureForAttach(ventureId);const rows=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "IncomeEntry" WHERE "id"=${incomeEntryId} LIMIT 1`;if(!rows[0])throw new Error(`Income entry not found: ${incomeEntryId}.`);if(rows[0].ventureId&&rows[0].ventureId!==ventureId)throw new Error(`Income entry ${incomeEntryId} is already scoped to another venture.`);await db.$executeRaw`UPDATE "IncomeEntry" SET "ventureId"=${ventureId} WHERE "id"=${incomeEntryId}`}

export async function getVentureCommercialSnapshot(ventureId:string):Promise<VentureCommercialSnapshot>{await assertVentureForAttach(ventureId);const [customers,opportunities,transactions,campaigns,incomeEntries,subscriptions,invoices,transactionRevenue,campaignRevenue,incomeRecorded,openInvoices,paidInvoices,activeSubscriptions]=await Promise.all([
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Customer" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Opportunity" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Transaction" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "MarketingCampaign" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "IncomeEntry" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Subscription" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Invoice" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{total:number|null}>>`SELECT COALESCE(SUM("amount"),0)::double precision AS total FROM "Transaction" WHERE "ventureId"=${ventureId} AND "status"='succeeded'`,
  db.$queryRaw<Array<{total:number|null}>>`SELECT COALESCE(SUM("revenue"),0)::double precision AS total FROM "MarketingCampaign" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{total:number|null}>>`SELECT COALESCE(SUM("amount"),0)::double precision AS total FROM "IncomeEntry" WHERE "ventureId"=${ventureId}`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Invoice" WHERE "ventureId"=${ventureId} AND "status" IN ('open','past_due')`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Invoice" WHERE "ventureId"=${ventureId} AND "status"='paid'`,
  db.$queryRaw<Array<{count:bigint}>>`SELECT COUNT(*)::bigint AS count FROM "Subscription" WHERE "ventureId"=${ventureId} AND "status"='active'`,
]); const count=(rows:Array<{count:bigint}>)=>Number(rows[0]?.count??0);return{ventureId,customers:count(customers),opportunities:count(opportunities),transactions:count(transactions),campaigns:count(campaigns),incomeEntries:count(incomeEntries),subscriptions:count(subscriptions),invoices:count(invoices),grossTransactionRevenue:Number(transactionRevenue[0]?.total??0),campaignRevenue:Number(campaignRevenue[0]?.total??0),incomeRecorded:Number(incomeRecorded[0]?.total??0),openInvoices:count(openInvoices),paidInvoices:count(paidInvoices),activeSubscriptions:count(activeSubscriptions)}}

export async function createSubscription(input:SubscriptionInput):Promise<string>{await assertVentureForAttach(input.ventureId);const customer=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "Customer" WHERE "id"=${input.customerId} LIMIT 1`;if(!customer[0]||customer[0].ventureId!==input.ventureId)throw new Error('Subscription customer must belong to the same venture.');const amount=positiveAmount(input.amount,'Subscription amount');const currency=clean(input.currency??'USD').toUpperCase();const interval=clean(input.interval??'month').toLowerCase();if(!/^[A-Z]{3}$/.test(currency))throw new Error('Subscription currency must be ISO-4217 alpha-3.');const id=`sub_${input.provider}_${input.providerSubscriptionId??`${input.ventureId}_${input.customerId}_${input.plan}`}`;await db.$executeRaw`INSERT INTO "Subscription" ("id","ventureId","customerId","provider","providerSubscriptionId","status","plan","amount","currency","interval","currentPeriodStart","currentPeriodEnd","cancelAtPeriodEnd","rawPayload") VALUES (${id},${input.ventureId},${input.customerId},${clean(input.provider)},${input.providerSubscriptionId??null},${input.status??'active'},${clean(input.plan)},${amount},${currency},${interval},${isoOrNull(input.currentPeriodStart,'currentPeriodStart')},${isoOrNull(input.currentPeriodEnd,'currentPeriodEnd')},${input.cancelAtPeriodEnd??false},${input.rawPayload??null}) ON CONFLICT ("id") DO UPDATE SET "status"=EXCLUDED."status","amount"=EXCLUDED."amount","currency"=EXCLUDED."currency","interval"=EXCLUDED."interval","currentPeriodStart"=EXCLUDED."currentPeriodStart","currentPeriodEnd"=EXCLUDED."currentPeriodEnd","cancelAtPeriodEnd"=EXCLUDED."cancelAtPeriodEnd","rawPayload"=EXCLUDED."rawPayload","updatedAt"=CURRENT_TIMESTAMP`;return id}

export async function createInvoice(input:InvoiceInput):Promise<string>{await assertVentureForAttach(input.ventureId);const customer=await db.$queryRaw<Array<{id:string;ventureId:string|null}>>`SELECT "id","ventureId" FROM "Customer" WHERE "id"=${input.customerId} LIMIT 1`;if(!customer[0]||customer[0].ventureId!==input.ventureId)throw new Error('Invoice customer must belong to the same venture.');if(input.subscriptionId){const subscription=await db.$queryRaw<Array<{id:string;ventureId:string}>>`SELECT "id","ventureId" FROM "Subscription" WHERE "id"=${input.subscriptionId} LIMIT 1`;if(!subscription[0]||subscription[0].ventureId!==input.ventureId)throw new Error('Invoice subscription must belong to the same venture')}const amount=positiveAmount(input.amount,'Invoice amount');const currency=clean(input.currency??'USD').toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new Error('Invoice currency must be ISO-4217 alpha-3.');if(input.transactionId){const transaction=await assertRealSucceededTransaction({ventureId:input.ventureId,transactionId:input.transactionId,amount:input.status==='paid'?amount:undefined,currency:input.status==='paid'?currency:undefined});if(transaction.customerId&&transaction.customerId!==input.customerId)throw new Error('Invoice transaction customer does not match invoice customer.')}const id=`inv_${input.provider}_${input.providerInvoiceId??`${input.ventureId}_${input.customerId}_${amount}_${Date.now()}`}`;await db.$executeRaw`INSERT INTO "Invoice" ("id","ventureId","customerId","subscriptionId","transactionId","provider","providerInvoiceId","status","amount","currency","dueAt","paidAt","rawPayload") VALUES (${id},${input.ventureId},${input.customerId},${input.subscriptionId??null},${input.transactionId??null},${clean(input.provider)},${input.providerInvoiceId??null},${input.status??'open'},${amount},${currency},${isoOrNull(input.dueAt,'dueAt')},${isoOrNull(input.paidAt,'paidAt')},${input.rawPayload??null}) ON CONFLICT ("id") DO UPDATE SET "status"=EXCLUDED."status","amount"=EXCLUDED."amount","currency"=EXCLUDED."currency","dueAt"=EXCLUDED."dueAt","paidAt"=EXCLUDED."paidAt","rawPayload"=EXCLUDED."rawPayload","updatedAt"=CURRENT_TIMESTAMP`;return id}
