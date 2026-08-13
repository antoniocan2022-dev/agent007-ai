import type {PortfolioBusiness,PortfolioDecision} from './portfolio-intelligence-contract'
export interface PortfolioMetric{business:PortfolioBusiness;revenue:number;cost:number;customers:number;leads:number|null;conversions:number|null;automation:number|null;satisfaction:number|null;confidence:number;observedPeriods:number;source:string;period:string}
export interface PortfolioSnapshot{snapshotId:string;createdAt:string;metrics:PortfolioMetric[];revenue:number;cost:number;netRevenue:number;margin:number;customers:number;health:number}
export interface AllocationRecommendation{business:PortfolioBusiness;decision:PortfolioDecision;score:number;confidence:number;rationale:string;priority:number;requiresHumanApproval:boolean}
export interface PortfolioDecisionRecord extends AllocationRecommendation{decisionId:string;snapshotId:string;evidenceIds:string[];createdAt:string;status:'recommended'|'approved'|'rejected'|'executed'}
export type PortfolioExperimentStatus='proposed'|'approved'|'running'|'completed'|'rejected'
export interface PortfolioExperiment{experimentId:string;business:PortfolioBusiness;hypothesis:string;metric:string;baseline:number;target:number;budget:number;status:PortfolioExperimentStatus;createdAt:string}
