import { createHash } from 'node:crypto'
import { db } from './db'

export type ExecutionReceiptInput = {
  missionId: string
  actorId: string
  actorType: string
  action: string
  status: string
  idempotencyKey: string
  requestHash?: string
  inputReference?: string
  outputReference?: string
  errorCode?: string
  startedAt?: Date
  completedAt?: Date
  metadata?: Record<string, unknown>
  userId?: string
}

export type EvidenceSourceInput = { provider:string; sourceUrl:string; retrievedAt?:Date; rawEvidenceRef:string; rawEvidence:unknown; requestHash?:string }
export type EvidenceClaimInput = { claimKey:string; claimText:string; classification:'FACT'|'HYPOTHESIS'|'INFERENCE'|'CONTRADICTED'; confidence:number; verificationStatus:'UNVERIFIED'|'VERIFIED'|'REJECTED'|'PARTIAL'; sourceIndex?:number; notes?:string }
export type EvidenceLedgerInput = { missionId:string; title:string; idempotencyKey:string; status?:'draft'|'verified'|'rejected'|'superseded'; userId?:string; previousHash?:string; sources:EvidenceSourceInput[]; claims:EvidenceClaimInput[] }
export type EvidenceLedgerVerification = { valid:boolean; ledgerId:string; missionId:string; version:number; expectedHash:string; actualHash:string; sourceCount:number; claimCount:number; errors:string[] }

type StoredSource = { id:string; provider:string; sourceUrl:string; retrievedAt:Date; rawEvidenceRef:string; rawEvidenceHash:string; requestHash:string|null }
type HashClaim = { claimKey:string; claimText:string; classification:string; confidence:number; verificationStatus:string; sourceKey:string|null; notes:string|null }

afunction assertNonEmpty(name:string,value:string):void { if(!value.trim()) throw new Error(`${name} must not be empty`) }
function assertConfidence(value:number):void { if(!Number.isFinite(value)||value<0||value>1) throw new Error('confidence must be a finite number between 0 and 1') }

export function canonicalJson(value:unknown):string {
  if(value===undefined||value===null||typeof value!=='object') return JSON.stringify(value)
  if(value instanceof Date) return JSON.stringify(value.toISOString())
  if(Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object=value as Record<string,unknown>
  return `{${Object.keys(object).sort().map((key)=>`${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
}
export function sha256(value:unknown):string { return createHash('sha256').update(canonicalJson(value),'utf8').digest('hex') }

function parseMetadata(value:string|null):Record<string,unknown>|null { if(!value) return null; try { const parsed:unknown=JSON.parse(value); return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null } catch { return null } }
function receiptFingerprint(input: { missionId:string; actorId:string; actorType:string; action:string; status:string; idempotencyKey:string; requestHash?:string|null; inputReference?:string|null; outputReference?:string|null; errorCode?:string|null; metadata?:Record<string,unknown>|null }):string { return sha256({missionId:input.missionId,actorId:input.actorId,actorType:input.actorType,action:input.action,status:input.status,idempotencyKey:input.idempotencyKey,requestHash:input.requestHash??null,inputReference:input.inputReference??null,outputReference:input.outputReference??null,errorCode:input.errorCode??null,metadata:input.metadata??null}) }
function assertReceiptCompatible(existing:{missionId:string;actorId:string;actorType:string;action:string;status:string;idempotencyKey:string;requestHash:string|null;inputReference:string|null;outputReference:string|null;errorCode:string|null;metadata:string|null},input:ExecutionReceiptInput):void {
  const expected=receiptFingerprint({...input,requestHash:input.requestHash??null,inputReference:input.inputReference??null,outputReference:input.outputReference??null,errorCode:input.errorCode??null,metadata:input.metadata??null})
  const actual=receiptFingerprint({...existing,metadata:parseMetadata(existing.metadata)})
  if(expected!==actual) throw new Error(`Execution receipt idempotency conflict for ${input.missionId}:${input.idempotencyKey}.`)
}

export async function recordExecutionReceipt(input:ExecutionReceiptInput) {
  for(const [name,value] of Object.entries({missionId:input.missionId,actorId:input.actorId,actorType:input.actorType,action:input.action,status:input.status,idempotencyKey:input.idempotencyKey})) assertNonEmpty(name,value)
  const existing=await db.executionReceipt.findUnique({where:{missionId_idempotencyKey:{missionId:input.missionId,idempotencyKey:input.idempotencyKey}}})
  if(existing){assertReceiptCompatible(existing,input);return{receipt:existing,created:false}}
  const startedAt=input.startedAt??new Date()
  const data={missionId:input.missionId,userId:input.userId,actorId:input.actorId,actorType:input.actorType,action:input.action,status:input.status,idempotencyKey:input.idempotencyKey,requestHash:input.requestHash,inputReference:input.inputReference,outputReference:input.outputReference,errorCode:input.errorCode,startedAt,completedAt:input.completedAt,recordHash:receiptFingerprint({...input,metadata:input.metadata??null}),metadata:input.metadata?canonicalJson(input.metadata):undefined}
  try{return{receipt:await db.executionReceipt.create({data}),created:true}}catch(error){const concurrent=await db.executionReceipt.findUnique({where:{missionId_idempotencyKey:{missionId:input.missionId,idempotencyKey:input.idempotencyKey}}});if(!concurrent)throw error;assertReceiptCompatible(concurrent,input);return{receipt:concurrent,created:false}}
}

function sourceKey(source:Pick<StoredSource,'provider'|'sourceUrl'|'rawEvidenceRef'|'rawEvidenceHash'|'requestHash'>):string { return sha256({provider:source.provider,sourceUrl:source.sourceUrl,rawEvidenceRef:source.rawEvidenceRef,rawEvidenceHash:source.rawEvidenceHash,requestHash:source.requestHash??null}) }
function hashClaimsFromInput(input:EvidenceLedgerInput,prepared:StoredSource[]):HashClaim[]{return input.claims.map((c)=>({claimKey:c.claimKey,claimText:c.claimText,classification:c.classification,confidence:c.confidence,verificationStatus:c.verificationStatus,sourceKey:c.sourceIndex===undefined?null:sourceKey(prepared[c.sourceIndex]),notes:c.notes??null}))}
function ledgerContentHash(input:{missionId:string;version:number;title:string;status:string;previousHash:string|null;sources:StoredSource[];claims:HashClaim[]}):string {
  const sources=[...input.sources].sort((a,b)=>sourceKey(a).localeCompare(sourceKey(b))).map((s)=>({key:sourceKey(s),provider:s.provider,sourceUrl:s.sourceUrl,retrievedAt:s.retrievedAt,rawEvidenceRef:s.rawEvidenceRef,rawEvidenceHash:s.rawEvidenceHash,requestHash:s.requestHash??null}))
  const claims=[...input.claims].sort((a,b)=>a.claimKey.localeCompare(b.claimKey))
  return sha256({missionId:input.missionId,version:input.version,title:input.title,status:input.status,previousHash:input.previousHash,sources,claims})
}
function prepareSources(input:EvidenceSourceInput[]):StoredSource[]{return input.map((s,i)=>({id:`input-${i}`,provider:s.provider,sourceUrl:s.sourceUrl,retrievedAt:s.retrievedAt??new Date(),rawEvidenceRef:s.rawEvidenceRef,rawEvidenceHash:sha256(s.rawEvidence),requestHash:s.requestHash??null}))}
function validateLedgerInput(input:EvidenceLedgerInput):void {
  assertNonEmpty('missionId',input.missionId);assertNonEmpty('title',input.title);assertNonEmpty('idempotencyKey',input.idempotencyKey)
  if(!Array.isArray(input.sources)||!Array.isArray(input.claims)) throw new Error('sources and claims must be arrays')
  const sourceKeys=new Set<string>(); const claimKeys=new Set<string>()
  input.sources.forEach((s,i)=>{assertNonEmpty(`source[${i}].provider`,s.provider);assertNonEmpty(`source[${i}].sourceUrl`,s.sourceUrl);assertNonEmpty(`source[${i}].rawEvidenceRef`,s.rawEvidenceRef);if(s.retrievedAt&&!Number.isFinite(s.retrievedAt.getTime()))throw new Error(`source[${i}].retrievedAt must be a valid date`);const key=sourceKey({provider:s.provider,sourceUrl:s.sourceUrl,rawEvidenceRef:s.rawEvidenceRef,rawEvidenceHash:sha256(s.rawEvidence),requestHash:s.requestHash??null});if(!sourceKeys.add(key))throw new Error(`Duplicate evidence source provenance at index ${i}.`)})
  input.claims.forEach((c,i)=>{assertNonEmpty(`claim[${i}].claimKey`,c.claimKey);assertNonEmpty(`claim[${i}].claimText`,c.claimText);assertConfidence(c.confidence);if(c.sourceIndex!==undefined&&(!Number.isInteger(c.sourceIndex)||c.sourceIndex<0||c.sourceIndex>=input.sources.length))throw new Error(`Claim ${c.claimKey} references invalid source index ${c.sourceIndex}.`);if(!claimKeys.add(c.claimKey))throw new Error(`Duplicate evidence claim key: ${c.claimKey}.`)})
}
function inputIdentity(input:EvidenceLedgerInput,status:string,previousHash:string|null,prepared:StoredSource[]):string{return sha256({missionId:input.missionId,title:input.title,status,previousHash,sources:prepared.map((s)=>({key:sourceKey(s),provider:s.provider,sourceUrl:s.sourceUrl,rawEvidenceRef:s.rawEvidenceRef,rawEvidenceHash:s.rawEvidenceHash,requestHash:s.requestHash})),claims:hashClaimsFromInput(input,prepared)})}
function storedIdentity(existing:{missionId:string;title:string;status:string;previousHash:string|null;Source:StoredSource[];Claim:Array<{claimKey:string;claimText:string;classification:string;confidence:number;verificationStatus:string;notes:string|null;sourceId:string|null}>}):string {const sourceById=new Map(existing.Source.map((s)=>[s.id,s]));const claims=existing.Claim.map((c)=>({claimKey:c.claimKey,claimText:c.claimText,classification:c.classification,confidence:c.confidence,verificationStatus:c.verificationStatus,sourceKey:c.sourceId?sourceKey(sourceById.get(c.sourceId)!):null,notes:c.notes??null}));return sha256({missionId:existing.missionId,title:existing.title,status:existing.status,previousHash:existing.previousHash,sources:existing.Source.map((s)=>({key:sourceKey(s),provider:s.provider,sourceUrl:s.sourceUrl,rawEvidenceRef:s.rawEvidenceRef,rawEvidenceHash:s.rawEvidenceHash,requestHash:s.requestHash})),claims})}
function assertLedgerCompatible(existing:Parameters<typeof storedIdentity>[0],input:EvidenceLedgerInput):void {const prepared=prepareSources(input.sources);const status=input.status??existing.status;const previousHash=input.previousHash??existing.previousHash??null;if(input.previousHash&&input.previousHash!==existing.previousHash)throw new Error(`Evidence ledger idempotency conflict for ${input.missionId}:${input.idempotencyKey}: previousHash differs.`);if(inputIdentity(input,status,previousHash,prepared)!==storedIdentity(existing))throw new Error(`Evidence ledger idempotency conflict for ${input.missionId}:${input.idempotencyKey}.`)}

export async function persistEvidenceLedger(input:EvidenceLedgerInput){
  validateLedgerInput(input);const status=input.status??'draft';const prepared=prepareSources(input.sources)
  const existing=await db.evidenceLedger.findUnique({where:{missionId_idempotencyKey:{missionId:input.missionId,idempotencyKey:input.idempotencyKey}},include:{Source:true,Claim:true}})
  if(existing){assertLedgerCompatible(existing,input);return{ledger:existing,created:false}}
  const latest=await db.evidenceLedger.findFirst({where:{missionId:input.missionId},orderBy:{version:'desc'}})
  if(input.previousHash!==undefined&&input.previousHash!==(latest?.contentHash??null))throw new Error('previousHash does not match the latest ledger version.')
  const version=(latest?.version??0)+1;const previousHash=latest?.contentHash??null
  const hashSources=prepared.map((s)=>s);const contentHash=ledgerContentHash({missionId:input.missionId,version,title:input.title,status,previousHash,sources:hashSources,claims:hashClaimsFromInput(input,prepared)})
  try{const ledger=await db.$transaction(async(tx)=>{const created=await tx.evidenceLedger.create({data:{missionId:input.missionId,userId:input.userId,idempotencyKey:input.idempotencyKey,version,title:input.title,status,previousHash,contentHash}});const createdSources: Array<{ id: string }> = [];for(const s of prepared)createdSources.push(await tx.evidenceSource.create({data:{ledgerId:created.id,provider:s.provider,sourceUrl:s.sourceUrl,retrievedAt:s.retrievedAt,rawEvidenceRef:s.rawEvidenceRef,rawEvidenceHash:s.rawEvidenceHash,requestHash:s.requestHash}}));for(const c of input.claims)await tx.evidenceClaim.create({data:{ledgerId:created.id,sourceId:c.sourceIndex===undefined?undefined:createdSources[c.sourceIndex]?.id,claimKey:c.claimKey,claimText:c.claimText,classification:c.classification,confidence:c.confidence,verificationStatus:c.verificationStatus,notes:c.notes}});return tx.evidenceLedger.findUniqueOrThrow({where:{id:created.id},include:{Source:true,Claim:true}})});return{ledger,created:true}}catch(error){const concurrent=await db.evidenceLedger.findUnique({where:{missionId_idempotencyKey:{missionId:input.missionId,idempotencyKey:input.idempotencyKey}},include:{Source:true,Claim:true}});if(!concurrent)throw error;assertLedgerCompatible(concurrent,input);return{ledger:concurrent,created:false}}
}

export async function verifyEvidenceLedger(ledgerId:string):Promise<EvidenceLedgerVerification>{
  assertNonEmpty('ledgerId',ledgerId);const ledger=await db.evidenceLedger.findUnique({where:{id:ledgerId},include:{Source:true,Claim:true}});if(!ledger)throw new Error(`Evidence ledger ${ledgerId} was not found`)
  const errors:string[]=[];const sourceById=new Map(ledger.Source.map((s)=>[s.id,s]));const hashClaims=ledger.Claim.map((c)=>({claimKey:c.claimKey,claimText:c.claimText,classification:c.classification,confidence:c.confidence,verificationStatus:c.verificationStatus,sourceKey:c.sourceId?sourceKey(sourceById.get(c.sourceId)!):null,notes:c.notes??null}));const actualHash=ledgerContentHash({missionId:ledger.missionId,version:ledger.version,title:ledger.title,status:ledger.status,previousHash:ledger.previousHash,sources:ledger.Source,claims:hashClaims})
  if(actualHash!==ledger.contentHash)errors.push('Ledger content hash mismatch');if(new Set(ledger.Claim.map((c)=>c.claimKey)).size!==ledger.Claim.length)errors.push('Duplicate claim keys detected');if(new Set(ledger.Source.map((s)=>sourceKey(s))).size!==ledger.Source.length)errors.push('Duplicate source provenance detected');for(const s of ledger.Source)if(!s.provider||!s.sourceUrl||!s.rawEvidenceRef||!s.rawEvidenceHash)errors.push(`Incomplete source provenance: ${s.id}`);for(const c of ledger.Claim){if(c.sourceId&&!sourceById.has(c.sourceId))errors.push(`Claim ${c.claimKey} references a missing source`);if(!Number.isFinite(c.confidence)||c.confidence<0||c.confidence>1)errors.push(`Claim ${c.claimKey} has invalid confidence`)}if(ledger.previousHash){const previous=await db.evidenceLedger.findFirst({where:{missionId:ledger.missionId,version:ledger.version-1}});if(!previous||previous.contentHash!==ledger.previousHash)errors.push('Ledger previousHash chain link is invalid')}
  return{valid:errors.length===0,ledgerId:ledger.id,missionId:ledger.missionId,version:ledger.version,expectedHash:ledger.contentHash,actualHash,sourceCount:ledger.Source.length,claimCount:ledger.Claim.length,errors}
}
