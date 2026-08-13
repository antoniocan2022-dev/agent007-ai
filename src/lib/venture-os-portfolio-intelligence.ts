import {buildPortfolioSnapshot,createOptimizationRecords} from './portfolio-intelligence-engine'
export async function getVentureOSPortfolioIntelligence(){const snapshot=await buildPortfolioSnapshot();const decisions=await createOptimizationRecords(snapshot);return{snapshot,decisions,source:'portfolio-intelligence'}}
