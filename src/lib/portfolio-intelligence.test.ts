import {describe,expect,it} from 'bun:test'
import {healthScore,optimize} from './portfolio-intelligence-rules'
import {forecast} from './portfolio-forecast'

describe('Phase 5 portfolio intelligence',()=>{
 it('bounds health scores',()=>{expect(healthScore({business:'revenue-recovery',revenue:100,cost:40,customers:5,leads:20,conversions:4,automation:70,satisfaction:80,confidence:90,source:'test',period:'2026-08-13'})).toBeGreaterThanOrEqual(0)})
 it('requires confidence for scale',()=>{const r=optimize({business:'operations-kit',revenue:200,cost:50,customers:10,leads:20,conversions:10,automation:90,satisfaction:90,confidence:50,source:'test',period:'2026-08-13'});expect(r.decision).not.toBe('scale')})
 it('produces bounded confidence forecasts',()=>{expect(forecast(100,.1,3,120).confidence).toBe(100)})
})
