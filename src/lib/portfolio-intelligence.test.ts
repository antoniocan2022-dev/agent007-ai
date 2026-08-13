import {describe,expect,it} from 'bun:test'
import {healthScore,optimize} from './portfolio-intelligence-rules'
import {forecast} from './portfolio-forecast'
import {summarizeAttribution} from './portfolio-attribution'
import {createPortfolioExperiment} from './portfolio-experiments'

describe('Phase 5 portfolio intelligence',()=>{
 it('does not treat missing operating evidence as observed',()=>{const score=healthScore({business:'revenue-recovery',revenue:100,cost:40,customers:5,leads:null,conversions:null,automation:70,satisfaction:null,confidence:0,observedPeriods:1,source:'test',period:'2026-08-13'});expect(score).toBe(33)})
 it('requires confidence for scale',()=>{const r=optimize({business:'operations-kit',revenue:200,cost:50,customers:10,leads:20,conversions:10,automation:90,satisfaction:90,confidence:50,observedPeriods:1,source:'test',period:'2026-08-13'});expect(r.decision).not.toBe('scale')})
 it('requires two observed periods before kill',()=>{const r=optimize({business:'career-command',revenue:0,cost:100,customers:0,leads:0,conversions:0,automation:0,satisfaction:0,confidence:90,observedPeriods:1,source:'test',period:'2026-08-13'});expect(r.decision).not.toBe('kill')})
 it('bounds confidence forecasts',()=>{expect(forecast('revenue-recovery',100,.1,3,120).confidence).toBe(100)})
 it('keeps attribution sources with delimiters intact',()=>{const rows=summarizeAttribution([{business:'revenue-recovery',source:'https://x.test/a:b',success:true}]);expect(rows[0]?.source).toBe('https://x.test/a:b')})
})
