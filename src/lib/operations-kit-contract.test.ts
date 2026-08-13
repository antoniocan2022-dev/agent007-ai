import{expect,test}from'bun:test'
import{validateOperationsKitContracts}from'./operations-kit-contract'
import{buildProcessObservation}from'./operations-kit-measurement'
import{scoreOperationsOpportunity}from'./operations-kit-rules'
test('Operations Kit contracts are unique',()=>expect(validateOperationsKitContracts()).toEqual([]))
test('invalid process ordering is rejected',()=>expect(()=>buildProcessObservation({tenantId:'t',customerId:'c',observedAt:'2026-08-13T00:00:00Z',processName:'billing',processType:'finance',description:'x',monthlyFrequency:10,minutesPerRun:30,errorEventsPerMonth:1,humanSteps:5,totalSteps:3,monthlyRevenueImpact:100,monthlyCostImpact:50,customerImpactScore:70,source:'crm'})).toThrow())
test('process scoring is bounded',()=>{const s=buildProcessObservation({tenantId:'t',customerId:'c',observedAt:'2026-08-13T00:00:00Z',processName:'billing',processType:'finance',description:'x',monthlyFrequency:100,minutesPerRun:20,errorEventsPerMonth:5,humanSteps:2,totalSteps:4,monthlyRevenueImpact:2000,monthlyCostImpact:500,customerImpactScore:80,source:'crm'});const o=scoreOperationsOpportunity(s);expect(o.automationFeasibility).toBeGreaterThan(0);expect(o.automationFeasibility).toBeLessThanOrEqual(.98);expect(o.estimatedMonthlyMinutesSaved).toBeGreaterThan(0)})
