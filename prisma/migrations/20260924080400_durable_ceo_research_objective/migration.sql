-- Durable CEO public-equity research objective identity.
-- Safe for repeated release reconciliation; the deploy-time reconciler also uses IF NOT EXISTS guards.
CREATE TABLE "CeoResearchObjective" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "lifecycleState" TEXT NOT NULL DEFAULT 'ESTABLISHED',
  "domain" TEXT NOT NULL,
  "evidenceProfile" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "temporalScope" TEXT NOT NULL,
  "objectiveAnchor" TEXT NOT NULL,
  "currentObjective" TEXT NOT NULL,
  "tickersJson" TEXT NOT NULL DEFAULT '[]',
  "issuersJson" TEXT NOT NULL DEFAULT '[]',
  "lastTurnSequence" INTEGER,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CeoResearchObjective_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CeoResearchObjective_conversationId_status_updatedAt_idx"
  ON "CeoResearchObjective"("conversationId", "status", "updatedAt");
CREATE INDEX "CeoResearchObjective_userId_status_updatedAt_idx"
  ON "CeoResearchObjective"("userId", "status", "updatedAt");
CREATE UNIQUE INDEX "CeoResearchObjective_conversation_active_key"
  ON "CeoResearchObjective"("conversationId")
  WHERE "status" = 'active';

CREATE TABLE "CeoResearchObjectiveEvent" (
  "id" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "fromVersion" INTEGER,
  "toVersion" INTEGER NOT NULL,
  "lifecycleState" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CeoResearchObjectiveEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CeoResearchObjectiveEvent_objectiveId_fkey"
    FOREIGN KEY ("objectiveId") REFERENCES "CeoResearchObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CeoResearchObjectiveEvent_objectiveId_createdAt_idx"
  ON "CeoResearchObjectiveEvent"("objectiveId", "createdAt");
CREATE INDEX "CeoResearchObjectiveEvent_conversationId_createdAt_idx"
  ON "CeoResearchObjectiveEvent"("conversationId", "createdAt");
