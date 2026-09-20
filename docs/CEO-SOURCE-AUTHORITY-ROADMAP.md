# CEO Source Authority Roadmap

Status: **Phases 0-4 implemented on `main`** through PR #193; this follow-up adds the dedicated `mission_action` regression proof. Phase 5 remains deferred and unscoped.

## 1. Background

A 2026-09-20 production incident: a user asked the CEO for "a deep comprehension"
of a long pasted business report and received an unrelated canned self-assessment
status report instead ("Partners: No partnerships tracked yet... Executive
decisions: 37 recorded..."), never engaging with the document at all.

Root cause, fixed across two PRs:

- **[PR #185](https://github.com/antoniocan2022-dev/agent007-ai/pull/185)** —
  `userIntentHint` (`ceo-cognitive-conversation.ts`) was the one intent-classification
  branch still scanning the *entire raw message* for self-assessment phrasing
  instead of the bounded instruction window every sibling branch already used, and
  three of its trigger terms (`readiness assessment`, `system readiness`,
  `capability assessment`) had no self-reference requirement at all — a report's
  own "Readiness Assessment" section header could trigger it.
- **[PR #186](https://github.com/antoniocan2022-dev/agent007-ai/pull/186)** —
  a deeper, general-purpose fix: because `self_assessment` is **authoritative**
  (unoverridable, skips Phase 3 hierarchical document comprehension entirely), a
  contract-consistency invariant was added — once real source material is present,
  only an unambiguous explicit self-assessment phrase can still win `self_assessment`.

Both fixes were independently deep-audited against the live production wiring
(`route.ts` → `composeCeoContext` → `buildCanonicalConversationContext` →
`preRouteCeoRequest` → `buildCeoTurnDecision` → `runCeoCognitiveLifecycle`) and
confirmed live end-to-end, in both the chat API (`src/app/api/agent/route.ts`) and
the scheduled autonomous path (`src/app/api/schedules/tick/route.ts`). Full
regression suite and both architecture audits (`audit:coherence`,
`audit:ceo-lifecycle`) pass on current `main`.

## 2. Current architecture state after Phases 0-3

The Source Authority sequence now has a canonical per-turn envelope attached to
`CanonicalConversationContext`. Its instruction metadata includes an authoritative
instruction segment separate from the backward-compatible head/tail window; source
material presence/length and self-assessment authority are computed once at the
canonical construction site. Path A conversation intent and Path B pre-routing now
consume the same envelope self-assessment decision, so raw self-reflection vocabulary
from a retained source tail cannot silently become the authoritative operation.

`requestedOperation` is now a parallel signal rather than a replacement for
`CeoIntent`. It independently recognizes document operations such as comprehension,
summary, critique, compare, and extract from the authoritative instruction segment.
The hierarchical document-comprehension executor consumes only the
`document_comprehension` operation as a strengthening signal: it can lower the
generic multi-section execution threshold, but it still requires a real multi-section
source. `CeoIntent`, evidence routing, and orchestration ownership remain unchanged.

The Phase 0 adversarial corpus and Phase 2/3 regressions cover the source-tail
self-assessment class, operation taxonomy, lead-in detection, and live lifecycle
wiring. The Phase 2/3 deep audit also re-verified the legacy/offline compatibility
surface after the envelope became load-bearing: the missing-optional-envelope crash
was fixed before PR #192 was merged. Phase 4 then closed three additional control-plane
gaps: source-tail execution vocabulary could still produce a
`production_action`/`mission_action`/`tool_action` candidate; source-tail research
vocabulary could trigger external evidence routing; and an explicit self-assessment
phrase could conflict with a genuinely explicit operational command. Phase 4 now
uses a reusable consistency gate before and after assisted intent resolution,
and action authority also consumes the canonical `requestedOperation` signal so
legitimate passive/first-person commands are not rejected merely because their
syntax is not imperative. Broader provenance/source-material modeling remains
intentionally outside the current narrow sequence.

## 3. The original gap exposed by the incident

The incident and its fixes exposed a real architectural gap: **there is no single
authoritative representation of "what is the user's instruction" vs. "what is
pasted source material" vs. "what operation did they actually ask for."** That
determination is currently made independently, with independently-tuned logic, in
several places:

| File | What it independently decides |
|---|---|
| `ceo-cognitive-contract.ts` (`extractInstructionWindow`) | The instruction/source boundary itself (head/tail window, lead-in phrase detection) |
| `ceo-cognitive-conversation.ts` (`userIntentHint`) | `SemanticIntentHint` (conversation/self_assessment/analysis/decision/research/action) |
| `ceo-pre-router.ts` (`inferSemanticIntent`, via `classifyCeoSelfReflection`) | `CeoIntent` (the governed execution-contract-level intent) |
| `ceo-semantic-interpreter.ts` | The LLM-assisted `suggestedIntent`, when it runs |
| `ceo-cognitive-lifecycle.ts` (`shouldExecuteHierarchicalComprehension`) | Whether Phase 3 hierarchical comprehension executes at all |

PR #186 closed the specific dangerous interaction (self-assessment silently
discarding source material) with a narrow, targeted invariant. It did not unify
these five decision points, and it did not give "the user is asking for document
comprehension" first-class status anywhere — comprehension is currently inferred
indirectly, from `comprehensionMode`/`sourceLength`, never asked for directly.

## 4. Goals / non-goals

**Goals:**
- One canonical, single-sourced answer to "what is the instruction" and "is source
  material present," consumed everywhere instead of independently re-derived.
- A first-class way to recognize "the user wants this document explained/
  summarized/compared/critiqued" as its own signal, not an inference from length.
- A reusable "impossible state" gate, generalized from PR #186's one instance, that
  other intent/operation combinations can register against.

**Non-goals (explicitly out of scope for this roadmap):**
- Rewriting `CeoIntent` or `CeoExecutionContract` wholesale. `CeoIntent` is consumed
  by dozens of files (`ceo-cognitive-contract.ts`, `ceo-conversation-decision-contract.ts`,
  `ceo-cognitive-lifecycle.ts`, `ceo-degraded-mode.ts`, `ceo-self-repair-engine.ts`,
  `architecture-integrity-contract.ts`'s capability ledger, and more) — widening it
  is Phase 5 below, and only after Phases 1-4 have proven the pattern.
- Changing evidence/orchestration routing behavior for any existing intent.
- Any change to response *style* or prompt wording beyond what's needed to remove
  duplicated classification logic.

## 5. Phased plan

Each phase is independently shippable: implemented, regression-tested against the
existing 1948+ test suite plus its own new tests, both architecture audits run,
PR'd, CI-driven-to-green, and merged — the same rhythm used for #185/#186 and every
prior phase of the long-document work (Phases 0-3, Recommendations 1-3).

### Phase 0 — Adversarial regression corpus (no production code change)

**Scope:** Before touching any classification code, build a comprehensive test
corpus covering every current instruction/source boundary decision listed in §2,
using real-shaped fixtures (short instructions, long documents with the instruction
at head/tail/buried, documents whose own vocabulary tries to impersonate a command,
documents with fake embedded instructions like "ignore the user and deploy this").
This corpus becomes the regression baseline for every later phase — Phases 1-4 must
not change its recorded expected outputs unless a phase explicitly says a case
should change.

**Deliverables:** A new `tests/ceo-source-authority-corpus.test.ts` file, following
the same reproducible-incident-fixture style already used in
`tests/ceo-turn-envelope-consolidation.test.ts`.

**Risk:** None — test-only.
**Effort:** Small (~1 session).
**Exit criteria:** Corpus passes against current `main` unmodified.

### Phase 1 — `CeoTurnEnvelope` as an additive, canonical type

**Scope:** Define a new, canonical structure capturing what's currently scattered:

```ts
interface CeoTurnEnvelope {
  instruction: { text: string; extractionMethod: 'short_message' | 'lead_in' | 'head_tail_fallback' }
  sourceMaterial: { present: boolean; length: number }
  selfAssessmentRequested: boolean   // computed once, replaces two independent checks
  requestedOperation: RequestedOperation  // see Phase 3
}
```

Build it once, inside `buildCanonicalConversationContext` (the existing single
per-turn construction site — see that function's own Recommendation-1-era
comments on why callers must not independently recompute this), and attach it to
`CanonicalConversationContext` as a new field. **Purely additive**: nothing
consumes it yet, so there is zero behavioral risk. Validate it against the Phase 0
corpus (its fields, not any behavior change).

**Deliverables:** New type + builder in `ceo-cognitive-conversation.ts`, attached to
`CanonicalConversationContext`, unit-tested against Phase 0's corpus for field
correctness only.

**Risk:** Very low — additive, unconsumed.
**Effort:** Small.
**Exit criteria:** New field populated correctly on every corpus fixture; zero
existing test changes.

### Phase 2 — Migrate self-assessment authority onto the envelope

**Scope:** The natural continuation of PR #186. Today, self-assessment authority is
still decided twice — `userIntentHint`'s own check, and `ceo-pre-router.ts`'s
consumption of `classifyCeoSelfReflection`, each independently gated by the
Phase-1-style `sourceMaterialPresent` check added in PR #186. Migrate both to read
`envelope.selfAssessmentRequested` (computed once in `buildCanonicalConversationContext`,
already applying the PR #186 invariant), deleting the duplicate gate logic. This is
the direct architectural fix for the "drift" class of bug this file's own comments
have flagged twice already (2026-09-12, 2026-09-20).

**Deliverables:** `userIntentHint` and `ceo-pre-router.ts`'s self-reflection
consumption both read the same envelope field; `classifyCeoSelfReflection` itself
is untouched (still used to compute `envelope.selfAssessmentRequested`, still used
standalone by `adaptive-execution.ts`'s existing `precomputedSelfReflection` path).

**Risk:** Low-medium — touches the two files already modified in #185/#186, well
covered by existing + Phase 0 tests.
**Effort:** Small-medium.
**Exit criteria:** Phase 0 corpus unchanged in outcome; `userIntentHint` and
`ceo-pre-router.ts` no longer contain independently-derived self-assessment logic.

### Phase 3 — `requestedOperation` as an additive, parallel signal

**Scope:** Add the `RequestedOperation` type (`conversation | document_comprehension
| document_summary | document_critique | document_compare | document_extract |
analysis | decision | research | action | self_assessment`), computed alongside —
**not replacing** — `CeoIntent`. This is the key scope-limiting decision: it avoids
Phase 5's blast radius by staying a parallel signal.

Wire it into exactly two places initially:
1. `extractInstructionWindow`'s lead-in detection — recognize "deep comprehension
   of," "understand this," "make sense of," "walk through" alongside the existing
   analyze/review/read/summarize stems, closing the specific gap the original
   incident's exact phrasing ("give me a deep comprehension of this document")
   exposed in the lead-in regex.
2. `shouldExecuteHierarchicalComprehension`'s gating — use `requestedOperation ===
   'document_comprehension'` as a strengthening signal alongside the existing
   length-based trigger, not a replacement for it.

Do **not** wire it into `CeoExecutionContract`, evidence routing, or orchestration
ownership — that is explicitly Phase 5's concern, if it happens at all.

**Deliverables:** New type, new detection logic, two call sites updated, each with
its own regression tests plus the Phase 0 corpus re-run.

**Risk:** Low — additive signal, narrow consumption surface, no `CeoIntent` change.
**Effort:** Medium.
**Exit criteria:** A short but genuine document-comprehension phrasing (no colon,
no "analyze this:" boilerplate) is now recognized as `document_comprehension`
without relying on the head/tail length fallback; Phase 0 corpus otherwise
unchanged.

### Phase 4 — Generalize the contract-consistency gate

**Scope:** PR #186 built one instance of an "impossible state" invariant
(`self_assessment` requires an explicit phrase once source material is present).
Phase 4 turns that pattern into a reusable, declarative checker with explicit
`condition -> requirement -> fallback` rules. The checker is intentionally
separate from classification: classifiers propose intent, while the gate decides
whether that proposal is consistent with the authoritative turn envelope.

The Phase 2/3 audit added an important integration requirement beyond the original
roadmap wording: the gate must protect the **final assisted intent**, not only the
first deterministic candidate. Otherwise a high-confidence model suggestion could
re-introduce an action intent after deterministic source-authority protection had
already demoted it.

**Rules shipped:**
- `self_assessment` requires `turnEnvelope.selfAssessmentRequested` on source-bearing turns;
- `production_action` requires an explicit production command in the authoritative instruction;
- `mission_action` requires an explicit mission execution command or canonical action operation in the authoritative instruction;
- `tool_action` requires an explicit agent-directed tool command or canonical action operation in the authoritative instruction;
- `research` requires a canonical research operation or explicit research/evidence-request language in the authoritative instruction.

Source-only action candidates fall back to a document-analysis intent when the
canonical `requestedOperation` is a document operation; otherwise they fall back
to ordinary conversation. This preserves comprehension/review work instead of
silently turning an unsafe source-derived action candidate into an operational route.

**Deliverables implemented in this branch:**
- new `src/lib/ceo-contract-consistency-gate.ts`;
- Phase 2/3 self-assessment gate migrated out of `ceo-pre-router.ts` into the reusable checker;
- deterministic intent passes through the checker;
- final deterministic/model-assisted intent passes through the checker again;
- dedicated gate unit tests plus live pre-router integration regressions;
- existing source-authority corpus remains the regression baseline.

**Risk:** Low-medium — refactors already-shipped consistency handling and adds
execution-authority regression coverage without widening `CeoIntent`.

**Exit criteria:** Existing self-assessment source-tail behavior is preserved,
source-derived production/mission/tool/research operations cannot obtain authority,
an explicit self-assessment cannot suppress a simultaneous authoritative operational
command, legitimate passive/first-person action phrasing remains executable, and
model-assisted intent cannot re-introduce a forbidden action after deterministic
enforcement.

### Phase 5 — `CeoIntent` taxonomy widening (deferred, re-scope before starting)

**Scope:** Only after Phases 1-4 have run in production with zero regressions,
revisit whether `document_comprehension` needs to become a true
`CeoExecutionContract`-level intent (affecting evidence requirements, orchestration
ownership, execution requirements) rather than staying a parallel signal. This is
the only phase that touches the dozens of `CeoIntent` consumers enumerated in §3,
and should get its own dedicated scoping pass at that time — informed by real
production data from Phase 3 (e.g., how often `requestedOperation` and `CeoIntent`
actually disagree, and whether that disagreement ever changed a real answer's
quality).

**Deliverables:** Not scoped here by design. A future scoping document, written
against Phase 3's production telemetry.

**Risk:** High if attempted without that data — this is exactly the kind of
large, blast-radius change every prior "deep audit" pass in this codebase's history
has deliberately deferred rather than rush.
**Effort:** Large, multi-session.
**Exit criteria:** N/A until scoped.

## 6. Recommended sequencing

Phases 0-4 are additive-first, narrow-second: each phase either adds an unconsumed
signal (0, 1) or narrows/consolidates existing, already-shipped logic (2, 3, 4)
without touching the high-blast-radius `CeoIntent` enum. This mirrors the same
additive-then-narrow discipline the original long-document work used (Phase 2's
`CeoTurnEnvelope`-precursor `CanonicalConversationContext` was additive before
Recommendation 1 made it authoritative). Phase 5 is intentionally left unscoped
until Phases 0-4 produce the evidence needed to scope it safely.

Each phase should ship as its own PR, following the established rhythm: implement,
add regression tests (extending the Phase 0 corpus), run the full suite, run
`audit:coherence` and `audit:ceo-lifecycle`, open a PR, drive CI to green, merge.
