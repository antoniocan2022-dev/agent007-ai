-- "Next architecture" program, Stage 1: dedicated evidence-trace table, replacing persistence into
-- Memory (key/value, category 'evidence_trace'). Historical record only -- the applied release-time
-- mechanism is the IF NOT EXISTS-guarded reconciliation in src/lib/reconcile-production-schema.ts,
-- kept in sync with this file (same pattern as the CeoResearchObjective migration before it).
CREATE TABLE "CeoEvidenceTrace" (
  "id" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "requestId" TEXT,
  "objectiveId" TEXT,
  "objectiveVersion" INTEGER,
  "finalState" TEXT,
  "payload" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CeoEvidenceTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CeoEvidenceTrace_traceId_key" ON "CeoEvidenceTrace"("traceId");
CREATE INDEX "CeoEvidenceTrace_objectiveId_idx" ON "CeoEvidenceTrace"("objectiveId");
CREATE INDEX "CeoEvidenceTrace_createdAt_idx" ON "CeoEvidenceTrace"("createdAt");
