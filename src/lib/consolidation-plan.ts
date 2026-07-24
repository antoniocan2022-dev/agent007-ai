/**
 * consolidation-plan.ts — UPGRADE #120 (Finding 3)
 * ====================================================================
 * Plan for consolidating 15 overlapping autonomy files into ~5.
 *
 * THE PROBLEM (from external audit):
 *   89 lib files, 15 of which are autonomy-related with version
 *   proliferation (v2, v4, v5). Bug fixes likely need to be applied
 *   in 3-4 places. This is the signature of iterative AI-assisted
 *   development where each new problem gets a new file bolted on.
 *
 * THE PLAN:
 *   Phase 1 (DONE): Add deprecation headers to old files
 *   Phase 2 (TODO): Merge file pairs (max-autonomy-v2 → max-autonomy-engine,
 *                   quantum-v5 → quantum-autonomous-tools, etc.)
 *   Phase 3 (TODO): Update all imports in tools.ts
 *   Phase 4 (TODO): Delete old files + verify build passes
 *
 * TARGET: 89 → ~50 lib files
 *
 * CONSOLIDATION MAP:
 *
 * 1. max-autonomy-engine.ts (747 lines) + max-autonomy-v2.ts (864 lines)
 *    → Merge into: max-autonomy-engine.ts
 *    → Status: max-autonomy-v2.ts marked DEPRECATED
 *    → Risk: HIGH — both imported by tools.ts
 *
 * 2. full-autonomy-tools.ts (776 lines) + full-autonomy-v4-tools.ts (188 lines)
 *    → Merge into: full-autonomy-tools.ts
 *    → Status: full-autonomy-v4-tools.ts marked DEPRECATED
 *    → Risk: MEDIUM — v4 only has 2 tools (decision_matrix, autonomy_policy_enforcer)
 *
 * 3. quantum-autonomous-tools.ts (375 lines) + quantum-autonomous-v5-tools.ts (136 lines)
 *    → Merge into: quantum-autonomous-tools.ts
 *    → Status: quantum-autonomous-v5-tools.ts marked DEPRECATED
 *    → Risk: MEDIUM — v5 has a few tools
 *
 * 4. phase-upgrades.ts + phase3-enhancements.ts + phase3-optimization.ts + mission-phases.ts
 *    → Merge into: mission-lifecycle.ts
 *    → Status: NOT STARTED (needs audit of what each contains)
 *    → Risk: HIGH — need to check for unique functions
 *
 * 5. autonomy-accuracy-tools.ts + autonomous-resolution.ts + autonomy-tools.ts
 *    → Merge into: autonomy-tools.ts
 *    → Status: NOT STARTED
 *    → Risk: MEDIUM
 *
 * RULE GOING FORWARD:
 *   No new v2/v4/v5 files. If you need to improve a tool, edit the
 *   existing file. The version number goes in the commit message,
 *   not the filename.
 */

export const CONSOLIDATION_PLAN = {
  totalLibFiles: 89,
  targetLibFiles: 50,
  autonomyFiles: 15,
  targetAutonomyFiles: 5,
  status: 'Phase 1 complete — deprecation headers added. Phases 2-4 pending.',
  consolidationMap: [
    {
      old: 'max-autonomy-v2.ts',
      target: 'max-autonomy-engine.ts',
      status: 'DEPRECATED — marked for merge',
      risk: 'HIGH',
    },
    {
      old: 'full-autonomy-v4-tools.ts',
      target: 'full-autonomy-tools.ts',
      status: 'DEPRECATED — marked for merge',
      risk: 'MEDIUM',
    },
    {
      old: 'quantum-autonomous-v5-tools.ts',
      target: 'quantum-autonomous-tools.ts',
      status: 'DEPRECATED — marked for merge',
      risk: 'MEDIUM',
    },
    {
      old: 'phase-upgrades.ts + phase3-enhancements.ts + phase3-optimization.ts + mission-phases.ts',
      target: 'mission-lifecycle.ts',
      status: 'NOT STARTED — needs function audit',
      risk: 'HIGH',
    },
    {
      old: 'autonomy-accuracy-tools.ts + autonomous-resolution.ts',
      target: 'autonomy-tools.ts',
      status: 'NOT STARTED — needs function audit',
      risk: 'MEDIUM',
    },
  ],
  rule: 'No new v2/v4/v5 files. Edit existing files. Version goes in commit message, not filename.',
}
