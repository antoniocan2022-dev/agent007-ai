export const OPERATIONS_KIT_ID='operations-kit'
export const OPERATIONS_KIT_VERSION=1
export const OPERATIONS_KIT_BUSINESS='operations-kit' as const
export const OPERATIONS_KIT_TEAM=Object.freeze({leader:'SMB_OPERATIONS_LEADER',specialists:['PROCESS_DISCOVERY_SPECIALIST','SOP_ARCHITECT','WORKFLOW_AUTOMATION_SPECIALIST','CRM_OPERATIONS_SPECIALIST','ADMIN_AUTOMATION_SPECIALIST','FINANCE_OPERATIONS_SPECIALIST','KPI_CONTROLLER','CLIENT_ONBOARDING_SPECIALIST','KNOWLEDGE_MANAGER','PROCESS_IMPROVEMENT_SPECIALIST'] as const})
export const OPERATIONS_KIT_CAPABILITIES=Object.freeze(['process-discovery','process-mapping','process-mining','sop-generation','workflow-automation-design','automation-prioritization','operations-kpi-analysis','client-onboarding','knowledge-capture','continuous-improvement'] as const)
export type OperationsPriority='critical'|'high'|'medium'|'low'
export type ProcessType='revenue'|'customer-service'|'sales'|'operations'|'finance'|'administration'|'hr'|'marketing'
