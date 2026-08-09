import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const confirmation = process.env.DR_RESTORE_CONFIRMATION
const mode = process.env.DR_RESTORE_MODE ?? 'dry-run'
const productionUrl = process.env.AGENT007_PRODUCTION_DATABASE_URL
const recoveryUrl = process.env.AGENT007_DR_DATABASE_URL
const encryptionRaw = process.env.BACKUP_ENCRYPTION_KEY?.trim()

const TABLES = ['ApiKey','AuditLog','BankAccount','BusinessStrategy','ComplianceCheck','ContractDraft','Conversation','CustomSubagent','Customer','IncomeEntry','IncomingCommand','KnowledgeChunk','KnowledgeDoc','MLModel','MarketingCampaign','Memory','Message','MissionTracker','NotificationLog','Opportunity','Partnership','PayPalAccount','PendingManageAction','PhoneConfig','Prediction','RiskRegister','Schedule','ServicePackage','SystemHealth','Transaction','TwoFactorSecret','User','UserSetting','Experiment','PlatformConnection','RiskProfile','ScalingPlan','SentimentLog'] as const
const RESTORE_ORDER = ['User','AuditLog','UserSetting','ApiKey','BankAccount','BusinessStrategy','ComplianceCheck','ContractDraft','Customer','IncomeEntry','IncomingCommand','KnowledgeDoc','KnowledgeChunk','MLModel','MarketingCampaign','Memory','Opportunity','Partnership','PayPalAccount','PendingManageAction','PhoneConfig','Prediction','RiskProfile','RiskRegister','ScalingPlan','ServicePackage','SystemHealth','Transaction','TwoFactorSecret','Experiment','PlatformConnection','MissionTracker','SentimentLog','Schedule','CustomSubagent','Conversation','Message','NotificationLog'] as const
const SECRET_COLUMNS: Record<string,string[]> = { ApiKey:['key'], BankAccount:['accountNumber','routingNumber'], PayPalAccount:['clientSecret'], PhoneConfig:['callmebotApiKey','emailImapPassword'], PlatformConnection:['apiKey','apiSecret','accessToken'], Transaction:['rawPayload'], TwoFactorSecret:['secret','backupCodes'], User:['passwordHash'] }

if (confirmation !== 'RESTORE_AGENT007_DR') throw new Error('Missing explicit DR_RESTORE_CONFIRMATION=RESTORE_AGENT007_DR')
if (!productionUrl || !recoveryUrl) throw new Error('Both AGENT007_PRODUCTION_DATABASE_URL and AGENT007_DR_DATABASE_URL are required')
if (productionUrl === recoveryUrl) throw new Error('SAFETY STOP: recovery URL equals production URL')
if (!encryptionRaw) throw new Error('BACKUP_ENCRYPTION_KEY is required for the DR restore')

function hostOf(url:string){ try{return new URL(url).hostname}catch{return ''} }
function key(){ return /^[0-9a-fA-F]{64}$/.test(encryptionRaw!) ? Buffer.from(encryptionRaw!,'hex') : createHash('sha256').update(encryptionRaw!,'utf8').digest() }
function normalize(v:any):any{ if(v instanceof Date)return v.toISOString(); if(Array.isArray(v))return v.map(normalize); if(v&&typeof v==='object'){const o:any={};for(const[k,x]of Object.entries(v))o[k]=normalize(x);return o} return v }
function encrypt(v:any){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key(),iv),d=Buffer.from(JSON.stringify(v),'utf8');const ct=Buffer.concat([c.update(d),c.final()]);return [iv,c.getAuthTag(),ct].map(x=>x.toString('base64url')).join('.')}
function decrypt(p:string){const [i,t,d]=p.split('.');if(!i||!t||!d)throw new Error('Invalid encrypted secret envelope');const c=createDecipheriv('aes-256-gcm',key(),Buffer.from(i,'base64url'));c.setAuthTag(Buffer.from(t,'base64url'));return JSON.parse(Buffer.concat([c.update(Buffer.from(d,'base64url')),c.final()]).toString('utf8'))}
function canonical(v:any):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'}
function checksum(v:any){return createHash('sha256').update(canonical(v),'utf8').digest('hex')}

async function createBackup(client:PrismaClient){
  const tables:any={};let records=0;let encryptedRows=0
  for(const table of TABLES){const rows=await client.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}"`);const secrets=SECRET_COLUMNS[table]??[];const clean:any[]=[];const encrypted:any[]=[];for(const raw of rows){const row=normalize(raw);const out={...row};const fields:any={};for(const col of secrets){if(col in out&&out[col]!==null&&out[col]!==undefined){fields[col]=encrypt(out[col]);delete out[col]}}clean.push(out);if(Object.keys(fields).length){encrypted.push({id:String(row.id),fields});encryptedRows++}}tables[table]={rows:clean,encryptedSecrets:encrypted,count:rows.length,historicalSecretRedactions:0};records+=rows.length}
  const payload:any={backupVersion:'2.1',application:'Agent007 AI',generatedAt:new Date().toISOString(),gitCommit:process.env.GITHUB_SHA??'unknown',gitBranch:'main',environment:'production',schema:{expectedModels:38,exportedModels:Object.keys(tables).length},security:{secretPolicy:'AES-256-GCM encrypted',encryptedSecretRows:encryptedRows,historicalSecretRedactions:0},totals:{models:Object.keys(tables).length,records},tables}
  return {...payload,integrity:{algorithm:'SHA-256',checksum:checksum(payload)}}
}

async function main(){
  const ph=hostOf(productionUrl!),rh=hostOf(recoveryUrl!);if(!ph||!rh||ph===rh)throw new Error('SAFETY STOP: production and recovery database hosts could not be positively distinguished')
  const prod=new PrismaClient({datasources:{db:{url:productionUrl!}}});const dr=new PrismaClient({datasources:{db:{url:recoveryUrl!}}})
  try{await prod.$queryRaw`SELECT 1`;await dr.$queryRaw`SELECT 1`;const backup=await createBackup(prod);if(Object.keys(backup.tables).length!==38)throw new Error('Backup validation failed: expected 38 models');const copy={...backup};delete copy.integrity;if(checksum(copy)!==backup.integrity.checksum)throw new Error('Backup integrity checksum mismatch');const dryRun=mode!=='restore';let inserted=0,skipped=0,wouldInsert=0;const sourceCounts:any={};for(const t of TABLES)sourceCounts[t]=backup.tables[t].count
    if(!dryRun){for(const table of RESTORE_ORDER){const block=backup.tables[table];const sec=new Map((block.encryptedSecrets??[]).map((x:any)=>[String(x.id),x.fields??{}]));for(const raw of block.rows){const row:any={...raw};const fields=sec.get(String(row.id));if(fields)for(const[c,p]of Object.entries(fields as any))row[c]=decrypt(p as string);const cols=Object.keys(row);if(!cols.length)continue;const vals=cols.map(c=>row[c]);const placeholders=cols.map((_,i)=>'$'+(i+1)).join(',');const quoted=cols.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',');try{await dr.$executeRawUnsafe(`INSERT INTO "${table}" (${quoted}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,...vals);inserted++}catch{skipped++}}}}
    else wouldInsert=Object.values(backup.tables).reduce((n:any,b:any)=>n+b.rows.length,0)
    const verification:any={};for(const t of TABLES){const r=await dr.$queryRawUnsafe<any[]>(`SELECT COUNT(*)::bigint AS count FROM "${t}"`);verification[t]=Number(r[0]?.count??0)}
    const mismatches=dryRun?[]:TABLES.filter(t=>verification[t]!==sourceCounts[t]);const recoveryRecords=Object.values(verification).reduce((a:any,b:any)=>a+b,0)
    console.log(JSON.stringify({ok:mismatches.length===0,mode:dryRun?'dry-run':'restore',backupVersion:backup.backupVersion,checksum:backup.integrity.checksum,source:{host:ph,models:38,records:backup.totals.records},recovery:{host:rh,models:38,records:recoveryRecords},result:{dryRun,wouldInsert,inserted,skipped,models:38},mismatches},null,2));if(mismatches.length)throw new Error(`Recovery verification failed for ${mismatches.length} model(s): ${mismatches.join(', ')}`)
  }finally{await Promise.allSettled([prod.$disconnect(),dr.$disconnect()])}
}
main().catch(e=>{console.error(e);process.exit(1)})
