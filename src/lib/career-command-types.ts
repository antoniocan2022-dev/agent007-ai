import type {ApplicationStatus} from './career-command-contract'
export interface CareerProfileInput{tenantId:string;customerId:string;observedAt:string;targetRoles:string[];skills:string[];experienceYears:number;preferredLocations:string[];remotePreferred:boolean;salaryMinimum:number;source:string}
export interface CareerProfile extends CareerProfileInput{profileId:string;skillCount:number;createdAt:string}
export interface JobOpportunity{jobId:string;source:string;title:string;company:string;location:string;description:string;requiredSkills:string[];preferredSkills:string[];salaryMin:number|null;salaryMax:number|null;remote:boolean;postedAt:string|null;applicationUrl:string|null}
