import {db} from './db'
import {getPortfolio} from './business-portfolio'
import {normalizeMetric,optimize} from './portfolio-intelligence-rules'
import type {PortfolioBusiness} from './portfolio-intelligence-contract'
import type {PortfolioMetric,PortfolioSnapshot,PortfolioDecisionRecord} from './portfolio-intelligence-types'

const parse=(v:string)=>{try{return JSON.parse(v) as any}catch{return null}}
const businessKey=(name:string):PortfolioBusiness=>{const n=name.trim().toLocaleLowerCase();if(n==='ai revenue recovery for local businesses'||n==='revenue recovery')return'revenue-recovery';if(n==='small business operations kit'||n==='operations kit')return'operations-kit';if(n==='career command center'||n==='career command')return'career-command';throw new Error(`Unknown portfolio business: ${name}`)}

export async function buildPortfolioSnapshot():Promise<PortfolioSnapshot>{
 const businesses=await getPortfolio()
 const metrics:PortfolioMetric[]=businesses.filter(b=>b.lifecycle!=='retired').map(b=>normalizeMetric({business:businessKey(b.name),revenue:b.monthlyRevenue,cost:b.monthlyCost,customers:b.customerCount,leads:0,conversions:0,automation:b.automationLevel,satisfaction:50,confidence:50,source:'portfolio',period:new Date().toISOString().slice(0,10)}))
 const revenue=metrics.reduce((s,m)=>s+m.revenue,0)
 const cost=metrics.reduce((s,m)=>s+m.cost,0)
 const customers=metrics.reduce((s,m)=>s+m.customers,0)
 const margin=revenue>0?(revenue-cost)/revenue*100:0
 const health=metrics.length?Math.round(metrics.reduce((s,m)=>s+optimize(m).score,0)/metrics.length):0
 const snapshot:PortfolioSnapshot={snapshotId:`portfolio_snapshot_${Date.now()}`,createdAt:new Date().toISOString(),metrics,revenue,cost,netRevenue:revenue-cost,margin,customers,health}
 await db.memory.create({data:{key:snapshot.snapshotId,category:'portfolio_intelligence_snapshot',value:JSON.stringify(snapshot)}})
 return snapshot
}

export async function createOptimizationRecords(snapshot:PortfolioSnapshot):Promise<PortfolioDecisionRecord[]>{
 const records=await Promise.all(snapshot.metrics.map(async m=>{const r=optimize(m);const record:PortfolioDecisionRecord={...r,decisionId:`portfolio_decision_${m.business}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,snapshotId:snapshot.snapshotId,evidenceIds:[],createdAt:new Date().toISOString(),status:'recommended'};await db.memory.create({data:{key:record.decisionId,category:'portfolio_intelligence_decision',value:JSON.stringify(record)}});return record}))
 return records.sort((a,b)=>b.priority-a.priority)
}

export async function runPortfolioOptimization():Promise<{snapshot:PortfolioSnapshot;decisions:PortfolioDecisionRecord[]}>{const snapshot=await buildPortfolioSnapshot();return{snapshot,decisions:await createOptimizationRecords(snapshot)}}

export async function getPortfolioOptimizationHistory(limit=25):Promise<PortfolioDecisionRecord[]>{const records=await db.memory.findMany({where:{category:'portfolio_intelligence_decision'},orderBy:{createdAt:'desc'},take:Math.max(1,Math.min(100,limit))});return records.map(r=>parse(r.value)).filter(Boolean) as PortfolioDecisionRecord[]}
