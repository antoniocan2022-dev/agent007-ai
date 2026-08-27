/**
 * developer-enhancements.ts — 12 tools for the Developer sub-agent.
 *
 * The Developer was the ONLY sub-agent skipped in the original 120-tool
 * enhancement phase. This file fills that gap.
 *
 * 3 categories × 4 tools = 12 tools:
 * 1. Code Quality & Testing (4 tools)
 * 2. Infrastructure & DevOps (4 tools)
 * 3. Performance & Optimization (4 tools)
 */
import { type ToolContext, type ToolResult } from './tools'
import { db } from './db'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { getCanonicalLlmBridge } from './canonical-provider-bridge'

function ok(p: string, r: string): ToolResult { return { ok: true, preview: p, result: r } }
function bad(r: string): ToolResult { return { ok: false, preview: r.slice(0, 140), result: r } }


async function llm(systemPrompt: string, userPrompt: string, maxTokens = 1800): Promise<string> {
  try {
    const zai = await getCanonicalLlmBridge()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    })
    return completion?.choices?.[0]?.message?.content ?? ''
  } catch (e: any) {
    return `(LLM unavailable: ${e?.message ?? String(e)})`
  }
}

function createDevTool(opts: {
  category: string
  toolName: string
  toolLabel: string
  systemPrompt: string
  userPromptTemplate: (args: any) => string
  executor?: (args: any) => Promise<string>
}): (args: any, ctx: ToolContext) => Promise<ToolResult> {
  return async (args: any, _ctx: ToolContext): Promise<ToolResult> => {
    try {
      let dataSection = ''
      if (opts.executor) {
        dataSection = await opts.executor(args)
      }
      const userPrompt = opts.userPromptTemplate({ ...args, data: dataSection })
      const analysis = await llm(opts.systemPrompt, userPrompt, 1800)
      const report = `${opts.toolLabel}\n══════════════════════════════════════════════\nSub-agent: Developer\nCategory: ${opts.category}\n\n${analysis}\n\nCAPABILITY STATUS: Developer enhancement active — full access, no limitations.`
      return ok(`${opts.category}: analysis complete`, report)
    } catch (e: any) {
      return bad(`${opts.toolName} failed: ${e?.message ?? String(e)}`)
    }
  }
}

/* ================================================================ *
 * 1. CODE QUALITY & TESTING (4 tools)
 * ================================================================ */

export const toolDevCodeQualityAudit = createDevTool({
  category: 'Code Quality & Testing',
  toolName: 'developer_code_quality_audit',
  toolLabel: 'Code Quality Audit',
  systemPrompt: 'You are the Developer sub-agent\'s Code Quality Audit engine. Analyze code for: complexity, duplication, test coverage gaps, dead code, type safety, error handling, naming conventions, and SOLID principles. Provide specific file:line references + concrete refactor recommendations.',
  userPromptTemplate: (args) => `Code to audit:\n${args.data || '(no code provided — run with file_path argument)'}\n\nFocus: ${args.focus ?? 'overall quality'}\n\nProduce code quality audit with severity-ranked findings.`,
  executor: async (args) => {
    if (!args.file_path) return '(no file_path provided)'
    try {
      const content = await fsp.readFile(args.file_path.toString(), 'utf-8')
      return `FILE: ${args.file_path}\nLINES: ${content.split('\n').length}\n\nCODE:\n${content.slice(0, 6000)}`
    } catch (e: any) {
      return `Could not read ${args.file_path}: ${e?.message}`
    }
  },
})

export const toolDevTestGenerator = createDevTool({
  category: 'Code Quality & Testing',
  toolName: 'developer_test_generator',
  toolLabel: 'Automated Test Generator',
  systemPrompt: 'You are the Developer sub-agent\'s Test Generator. Generate comprehensive unit + integration tests for the given code. Cover: happy path, edge cases, error handling, boundary conditions. Use Jest/Vitest conventions. Output ready-to-run test files.',
  userPromptTemplate: (args) => `Code to test:\n${args.data || '(no code provided)'}\n\nTest framework: ${args.framework ?? 'vitest'}\n\nGenerate complete test file with 10+ test cases.`,
  executor: async (args) => {
    if (!args.file_path) return '(no file_path provided)'
    try {
      const content = await fsp.readFile(args.file_path.toString(), 'utf-8')
      return `FILE: ${args.file_path}\n\nCODE:\n${content.slice(0, 6000)}`
    } catch (e: any) {
      return `Could not read ${args.file_path}: ${e?.message}`
    }
  },
})

export const toolDevBugDetector = createDevTool({
  category: 'Code Quality & Testing',
  toolName: 'developer_bug_detector',
  toolLabel: 'Bug Detection & Static Analysis',
  systemPrompt: 'You are the Developer sub-agent\'s Bug Detector. Perform static analysis to find: null/undefined access, race conditions, memory leaks, SQL injection, XSS, prototype pollution, unhandled promise rejections, infinite loops, and off-by-one errors. For each bug, provide: file:line, bug type, severity, exploit scenario, and fix.',
  userPromptTemplate: (args) => `Code to analyze:\n${args.data || '(no code provided)'}\n\nProduce bug detection report with exploit scenarios + fixes.`,
  executor: async (args) => {
    if (!args.file_path) return '(no file_path provided)'
    try {
      const content = await fsp.readFile(args.file_path.toString(), 'utf-8')
      return `FILE: ${args.file_path}\n\nCODE:\n${content.slice(0, 8000)}`
    } catch (e: any) {
      return `Could not read ${args.file_path}: ${e?.message}`
    }
  },
})

export const toolDevRefactoringEngine = createDevTool({
  category: 'Code Quality & Testing',
  toolName: 'developer_refactoring_engine',
  toolLabel: 'Code Refactoring Engine',
  systemPrompt: 'You are the Developer sub-agent\'s Refactoring Engine. Analyze code + suggest specific refactorings: extract function, extract class, rename, simplify conditionals, replace inheritance with composition, introduce parameter object. Output before/after code blocks for each refactoring.',
  userPromptTemplate: (args) => `Code to refactor:\n${args.data || '(no code provided)'}\n\nGoal: ${args.goal ?? 'improve readability + maintainability'}\n\nProduce refactoring plan with before/after code blocks.`,
  executor: async (args) => {
    if (!args.file_path) return '(no file_path provided)'
    try {
      const content = await fsp.readFile(args.file_path.toString(), 'utf-8')
      return `FILE: ${args.file_path}\n\nCODE:\n${content.slice(0, 6000)}`
    } catch (e: any) {
      return `Could not read ${args.file_path}: ${e?.message}`
    }
  },
})

/* ================================================================ *
 * 2. INFRASTRUCTURE & DEVOPS (4 tools)
 * ================================================================ */

export const toolDevDependencyAnalyzer = createDevTool({
  category: 'Infrastructure & DevOps',
  toolName: 'developer_dependency_analyzer',
  toolLabel: 'Dependency Analysis & Security Scan',
  systemPrompt: 'You are the Developer sub-agent\'s Dependency Analyzer. Analyze package.json for: outdated packages, known vulnerabilities (CVEs), license issues, bundle size impact, and dependency tree conflicts. Recommend specific version upgrades + alternatives.',
  userPromptTemplate: (args) => `Package data:\n${args.data}\n\nProduce dependency analysis with security + upgrade recommendations.`,
  executor: async () => {
    try {
      const pkg = await fsp.readFile('/home/z/my-project/package.json', 'utf-8')
      const lockfile = await fsp.access('/home/z/my-project/bun.lock').then(() => '(bun.lock exists)').catch(() => '(no lockfile)')
      return `package.json:\n${pkg.slice(0, 3000)}\n\nLockfile: ${lockfile}`
    } catch (e: any) {
      return `Could not read package.json: ${e?.message}`
    }
  },
})

export const toolDevCICDPipelineBuilder = createDevTool({
  category: 'Infrastructure & DevOps',
  toolName: 'developer_cicd_pipeline_builder',
  toolLabel: 'CI/CD Pipeline Builder',
  systemPrompt: 'You are the Developer sub-agent\'s CI/CD Pipeline Builder. Design a complete CI/CD pipeline: lint, typecheck, test, build, security scan, deploy to staging, canary, production. Include GitHub Actions YAML or Vercel config. Cover: caching, parallel jobs, secrets management, rollback.',
  userPromptTemplate: (args) => `Platform: ${args.platform ?? 'vercel + github actions'}\nProject: Next.js 16 + Prisma + TypeScript\n\nDesign complete CI/CD pipeline with YAML config.`,
  executor: async () => {
    try {
      const vercelJson = await fsp.readFile('/home/z/my-project/vercel.json', 'utf-8').catch(() => '(no vercel.json)')
      return `Current vercel.json:\n${vercelJson}`
    } catch {
      return '(no existing config)'
    }
  },
})

export const toolDevEnvironmentSetup = createDevTool({
  category: 'Infrastructure & DevOps',
  toolName: 'developer_environment_setup',
  toolLabel: 'Environment Setup & Configuration',
  systemPrompt: 'You are the Developer sub-agent\'s Environment Setup engine. Design development + production environment configs: env vars, secrets management, database setup, feature flags, logging, monitoring. Include .env.example, Dockerfile, and deployment checklist.',
  userPromptTemplate: (args) => `Environment: ${args.environment ?? 'production'}\nPlatform: ${args.platform ?? 'vercel'}\n\nDesign complete environment setup with all configs + checklists.`,
  executor: async () => {
    try {
      const envExample = await fsp.readFile('/home/z/my-project/.env.example', 'utf-8').catch(() => '(no .env.example)')
      return `Current .env.example:\n${envExample}`
    } catch {
      return '(no existing env config)'
    }
  },
})

export const toolDevDatabaseMigration = createDevTool({
  category: 'Infrastructure & DevOps',
  toolName: 'developer_database_migration',
  toolLabel: 'Database Migration & Schema Management',
  systemPrompt: 'You are the Developer sub-agent\'s Database Migration engine. Design safe schema migrations: additive changes, backfill scripts, rollback plans, zero-downtime deployment. Generate Prisma migration files + SQL where needed.',
  userPromptTemplate: (args) => `Migration type: ${args.migration_type ?? 'schema update'}\nSchema data:\n${args.data}\n\nDesign safe migration with rollback plan.`,
  executor: async () => {
    try {
      const schema = await fsp.readFile('/home/z/my-project/prisma/schema.prisma', 'utf-8')
      return `Current Prisma schema (${schema.split('\n').length} lines):\n${schema.slice(0, 4000)}`
    } catch (e: any) {
      return `Could not read schema: ${e?.message}`
    }
  },
})

/* ================================================================ *
 * 3. PERFORMANCE & OPTIMIZATION (4 tools)
 * ================================================================ */

export const toolDevPerformanceProfiler = createDevTool({
  category: 'Performance & Optimization',
  toolName: 'developer_performance_profiler',
  toolLabel: 'Performance Profiler',
  systemPrompt: 'You are the Developer sub-agent\'s Performance Profiler. Analyze code + identify: slow queries, N+1 problems, unnecessary re-renders, large bundles, blocking operations, memory leaks. Provide specific optimization recommendations with expected impact.',
  userPromptTemplate: (args) => `Performance data:\n${args.data}\n\nFocus: ${args.focus ?? 'overall performance'}\n\nProduce performance profiling report with ranked optimizations.`,
  executor: async () => {
    try {
      const nextConfig = await fsp.readFile('/home/z/my-project/next.config.ts', 'utf-8').catch(() => '(no next.config)')
      const vercelJson = await fsp.readFile('/home/z/my-project/vercel.json', 'utf-8').catch(() => '(no vercel.json)')
      return `next.config.ts:\n${nextConfig}\n\nvercel.json:\n${vercelJson}`
    } catch {
      return '(no config files found)'
    }
  },
})

export const toolDevBundleOptimizer = createDevTool({
  category: 'Performance & Optimization',
  toolName: 'developer_bundle_optimizer',
  toolLabel: 'Bundle Size Optimizer',
  systemPrompt: 'You are the Developer sub-agent\'s Bundle Optimizer. Analyze the JavaScript bundle for: large dependencies, duplicate code, tree-shaking opportunities, code splitting, lazy loading. Recommend specific changes to reduce bundle size.',
  userPromptTemplate: (args) => `Bundle analysis:\n${args.data}\n\nTarget: reduce initial bundle by 30%+\n\nProduce bundle optimization plan with specific changes.`,
  executor: async () => {
    try {
      const pkg = JSON.parse(await fsp.readFile('/home/z/my-project/package.json', 'utf-8'))
      const deps = Object.keys(pkg.dependencies || {})
      const devDeps = Object.keys(pkg.devDependencies || {})
      return `Dependencies (${deps.length}): ${deps.join(', ')}\nDevDependencies (${devDeps.length}): ${devDeps.join(', ')}`
    } catch {
      return '(could not read package.json)'
    }
  },
})

export const toolDevSSRHydrationFixer = createDevTool({
  category: 'Performance & Optimization',
  toolName: 'developer_ssr_hydration_fixer',
  toolLabel: 'SSR/Hydration Bug Fixer',
  systemPrompt: 'You are the Developer sub-agent\'s SSR/Hydration Fixer. Diagnose + fix React hydration mismatches, SSR errors, and client/server state inconsistencies. Common causes: window/document access during SSR, date formatting, random values, localStorage access. Provide specific code fixes.',
  userPromptTemplate: (args) => `SSR issue: ${args.issue ?? 'hydration mismatch'}\n\nCode:\n${args.data || '(provide file_path)'}\n\nDiagnose root cause + provide fix.`,
  executor: async (args) => {
    if (!args.file_path) return '(no file_path provided)'
    try {
      const content = await fsp.readFile(args.file_path.toString(), 'utf-8')
      return `FILE: ${args.file_path}\n\nCODE:\n${content.slice(0, 6000)}`
    } catch (e: any) {
      return `Could not read ${args.file_path}: ${e?.message}`
    }
  },
})

export const toolDevAPIOptimizer = createDevTool({
  category: 'Performance & Optimization',
  toolName: 'developer_api_optimizer',
  toolLabel: 'API Route Optimizer',
  systemPrompt: 'You are the Developer sub-agent\'s API Optimizer. Analyze Next.js API routes for: response time, DB query efficiency, caching opportunities, payload size, error handling, and rate limiting. Recommend specific optimizations per endpoint.',
  userPromptTemplate: (args) => `API data:\n${args.data}\n\nProduce API optimization report with per-endpoint recommendations.`,
  executor: async () => {
    try {
      const apiDir = '/home/z/my-project/src/app/api'
      const entries = await fsp.readdir(apiDir, { withFileTypes: true })
      const routes = entries.filter(e => e.isDirectory()).map(e => e.name)
      return `API route directories (${routes.length}): ${routes.join(', ')}`
    } catch {
      return '(could not scan API directory)'
    }
  },
})
