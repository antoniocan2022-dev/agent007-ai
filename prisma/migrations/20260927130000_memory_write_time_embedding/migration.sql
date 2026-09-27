-- "Next architecture" program, Stage 3: write-time memory embeddings. Historical record only -- the
-- applied release-time mechanism is the IF NOT EXISTS-guarded reconciliation in
-- src/lib/reconcile-production-schema.ts, kept in sync with this file.
ALTER TABLE "Memory" ADD COLUMN "embedding" TEXT;
