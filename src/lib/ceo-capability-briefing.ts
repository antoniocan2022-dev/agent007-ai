// Answers "what can you do now / what upgrades have you had" with a real, bounded description of
// the CEO Evidence & Supervision Layer and document/media knowledge-base pipeline, instead of the
// CEO guessing or reciting stale facts. upgrade-manifest.ts (the codebase's older "permanent
// upgrade record") stopped being maintained many phases ago -- none of the executive-state,
// leadership, decision-synthesis, or evidence/supervision work from this session's recent phases is
// registered there, so extending it further would only compound a list the CEO already can't trust.
// This module instead describes only the two most recent, verified-wired feature sets directly, and
// checks live environment configuration so it never claims a capability that's actually disabled in
// this deployment (e.g. transcription without GROQ_API_KEY configured).
//
// Gated on the self-reflection classifier's existing 'capability_assessment' kind (ceo-self-
// reflection.ts) -- a question like "what are your capabilities/strengths/limitations" -- so this
// never adds noise to an ordinary turn, the same conditional-inclusion discipline every other
// context module (self_inspection, knowledge, evidence, mission) already follows.

export function renderCeoCapabilityBriefing(): string {
  const transcriptionConfigured = Boolean(process.env.GROQ_API_KEY?.trim())
  const semanticSearchConfigured = Boolean(process.env.MISTRAL_API_KEY?.trim())
  // Deep-audit fix (2026-09-13): production incident -- asked "what can I do to give you access to live
  // information", the CEO had no grounded facts about its own live-research tooling anywhere in this
  // briefing (only document/media ingestion was covered) and fell back to a generic non-answer. The
  // CEO's actual live-research toolset is the authoritative, curated capability ledger in
  // ceo-capability-architecture.ts's CEO_CAPABILITY_ARCHITECTURE ('research'/'market_intelligence'
  // capabilities), not the much larger general tool registry (tools.ts) most of which serves unrelated
  // operational capabilities (CRM, email, social, etc.) the user did not ask about here -- so this only
  // describes web_search/page_reader/SEC, the tools ceo-evidence-executor.ts actually calls.
  const braveConfigured = Boolean(process.env.BRAVE_API_KEY?.trim())

  const lines = [
    'CEO CAPABILITY BRIEFING (real, bounded facts about recent additions -- state these accurately, never round up to "any file" or "any type"):',
    '',
    'Live research & external information (already active -- nothing to configure to enable these):',
    '- Web search and page reading are already live for every research/decision turn (see ceo-evidence-executor.ts) -- no setup or credentials needed from the user.',
    '- SEC company facts (revenue, cash, debt, filings) for US-listed equities are fetched directly from SEC\'s public API, also with no credentials required.',
    `- Optional redundancy: a Brave Search API key is ${braveConfigured ? 'configured, providing a fallback search path if the primary search provider fails' : 'NOT configured in this environment -- web search still works via the primary provider, but there is no fallback if that provider has an outage; setting a BRAVE_API_KEY environment variable in the deployment would add one'}.`,
    '- There is no chat-based way to grant additional live-data access: new data sources are added by wiring new tools into the codebase and setting the relevant environment variable in the deployment, not by supplying a credential in conversation.',
    '',
    'Evidence & supervision:',
    '- Before answering a recommendation/decision, or a question about past attempts, checks its own open recommendations and recent execution outcomes (successes, failures, still-running work) rather than guessing. Read-only: it never re-triggers or replays a past action.',
    '- A human owner can record a review verdict (reviewed / approved / flagged / corrected / closed) against any recommendation. The count of owner-reviewed recommendations is now part of the executive decision ledger.',
    '',
    'Knowledge base (documents the user has uploaded):',
    '- Real text extraction for PDF (including compressed content streams, not just plain uncompressed text), DOCX, XLSX, and PPTX -- not a placeholder that only handles .txt/.md/.csv/.json.',
    `- Audio/video transcription for mp3, wav, ogg, flac, m4a, mp4, and webm is ${transcriptionConfigured ? 'configured and available' : 'built but NOT currently configured in this environment (requires GROQ_API_KEY)'}. Other video containers (avi, mov, mkv) are not supported -- there is no transcoding toolchain here to convert them.`,
    '- Files up to 5MB can be uploaded directly; larger files (up to 200MB) can be ingested from the existing large-file storage path, verified end-to-end (real size and checksum against the original upload) before any of it is read.',
    `- Search blends exact keyword matching with ${semanticSearchConfigured ? 'embedding-based semantic recovery (configured), so related content can surface even without shared vocabulary with the query' : 'keyword matching only in this environment -- semantic recovery is built but not configured (requires MISTRAL_API_KEY), so a genuinely related chunk with no shared vocabulary with the query will not surface yet'}.`,
    '- Relevant excerpts from the knowledge base are already surfaced automatically during conversation when they match what is being discussed -- no separate "search my documents" step is required.',
    '',
    'What this does not do: it cannot process a file synchronously beyond ~200MB, cannot transcribe unsupported video containers, and does not fabricate an extraction result when a PDF has no real text layer (e.g. a scanned image) -- it says so honestly instead.',
  ]
  return lines.join('\n')
}
